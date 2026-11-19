/**
 * DSH 插件入口：把「今日新词」读出来、把总结写下去。
 *
 * 职责边界（重要）：本插件**不联网**。例句/搭配这类要联网补的内容，
 * 由 agent 用自己的搜索工具补齐后，通过 supplements 参数回传；
 * 插件的 enrichMode 只表达「用户希望自动还是手动」，执行者是 agent。
 *
 * 配置来自与宿主共享的 %USERPROFILE%\.jp-vocab\config.json，
 * 每次调用时重新读取，改设置不需要重启 DSH。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localDate, readDay, mergeSupplements, buildSummary, loadTemplate,
} from './lib/format.js';
import { resolveConfig, writeSharedConfig, configPath } from './lib/config.js';

export const name = 'jp-vocab';
export const inject = ['tools'];

const TEMPLATE_PATH = fileURLToPath(new URL('./templates/daily-summary.md', import.meta.url));

/** 把对象包成给模型看的文本块（与已装插件的约定一致）。 */
function textOutput(schema) {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/** 每次调用现读配置：设置页改完立刻生效，不用重装插件。 */
function settingsOf(patchConfig) {
  return resolveConfig(patchConfig);
}

function todayOf(settings) {
  return localDate(settings.timeZone, new Date(), settings.dayStartHour);
}

/** 设置里给 agent 看的那部分（不含无关字段）。 */
function publicSettings(settings) {
  return {
    vocabDir: settings.vocabDir,
    summariesDir: settings.summariesDir,
    timeZone: settings.timeZone,
    dayStartHour: settings.dayStartHour,
    enrichMode: settings.enrichMode,
    overwrite: settings.overwrite,
    groupByPos: settings.groupByPos,
    templatePath: settings.templatePath || '(内置模板)',
    configFile: configPath(),
  };
}

const TODAY_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', description: '业务日期 YYYY-MM-DD；省略为今天（按配置的日界与日界时间）' },
  },
};

const SUMMARY_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', description: '业务日期 YYYY-MM-DD；省略为今天' },
    overwrite: { type: 'boolean', description: '已存在同名文件时是否覆盖；省略则用配置里的 overwrite' },
    supplements: {
      type: 'array',
      description: '联网补齐的内容，按 word 匹配词条；enrichMode=auto 时应先查好再传',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          word: { type: 'string' },
          reading: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
          collocations: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['word'],
      },
    },
  },
};

const SETTINGS_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['get', 'set'], description: 'get 读取当前配置；set 合并写入' },
    config: {
      type: 'object',
      additionalProperties: true,
      description: 'set 时只需给要改的字段，例如 {"dayStartHour": 6, "enrichMode": "manual"}',
    },
  },
  required: ['action'],
};

const TODAY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    date: { type: 'string' },
    file: { type: 'string' },
    count: { type: 'number' },
    words: { type: 'array', items: { type: 'object', additionalProperties: true } },
    settings: { type: 'object', additionalProperties: true },
  },
};

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    path: { type: 'string' },
    count: { type: 'number' },
    usedFallbackTemplate: { type: 'boolean' },
    message: { type: 'string' },
    settings: { type: 'object', additionalProperties: true },
  },
};

const SETTINGS_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    path: { type: 'string' },
    config: { type: 'object', additionalProperties: true },
    message: { type: 'string' },
  },
};

export function apply(ctx, rawConfig) {
  const patchConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  ctx.effect(() => {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
      ctx.logger?.warn?.('[jp-vocab] tools 服务不可用，工具未注册');
      return () => {};
    }
    const disposers = [];
    const register = (def) => {
      const dispose = tools.register(def);
      if (typeof dispose === 'function') disposers.push(dispose);
    };

    register({
      name: 'jp_vocab_today',
      description: '读取指定日期（默认今天，按配置的日界）星标收藏的日语词汇，返回词条列表、文件路径与当前配置；生成总结前先用它看有哪些词。',
      parameters: TODAY_PARAMS,
      output: textOutput(TODAY_SCHEMA),
      isConcurrencySafe: () => true,
      async execute(raw) {
        const settings = settingsOf(patchConfig);
        const date = raw?.date || todayOf(settings);
        const { file, words } = readDay(settings.vocabDir, date);
        return {
          ok: true,
          date,
          file,
          count: words.length,
          words: words.map((w) => ({
            word: w.word,
            reading: w.reading ?? null,
            pitch: w.pitch ?? null,
            pitchNumber: w.pitchNumber ?? null,
            pos: w.pos ?? [],
            gloss: w.gloss ?? '',
            examples: w.examples ?? [],
            context: w.context ?? '',
            url: w.url ?? null,
            count: w.count ?? 1,
          })),
          settings: publicSettings(settings),
        };
      },
    });

    register({
      name: 'jp_vocab_summary',
      description: '把指定日期（默认今天）的词汇按模板生成 Markdown 总结文件。enrichMode=auto 时先联网查好例句/搭配再通过 supplements 传入；是否覆盖同名文件由配置决定。',
      parameters: SUMMARY_PARAMS,
      output: textOutput(SUMMARY_SCHEMA),
      isConcurrencySafe: () => false,
      async execute(raw) {
        const settings = settingsOf(patchConfig);
        const date = raw?.date || todayOf(settings);
        const { words } = readDay(settings.vocabDir, date);
        if (!words.length) {
          return { ok: false, date, count: 0, message: `${date} 没有收藏任何词，未生成文件。`, settings: publicSettings(settings) };
        }

        const merged = mergeSupplements(words, Array.isArray(raw?.supplements) ? raw.supplements : []);
        const templatePath = settings.templatePath || TEMPLATE_PATH;
        const { template, usedFallback } = loadTemplate(templatePath);
        const { markdown, count } = buildSummary({
          date,
          words: merged,
          template,
          groupByPos: settings.groupByPos,
        });

        fs.mkdirSync(settings.summariesDir, { recursive: true });
        const outFile = path.join(settings.summariesDir, `${date}.md`);
        const overwrite = typeof raw?.overwrite === 'boolean' ? raw.overwrite : settings.overwrite;
        if (fs.existsSync(outFile) && !overwrite) {
          return {
            ok: false,
            date,
            path: outFile,
            count,
            message: '文件已存在，未覆盖（可在配置里把 overwrite 设为 true，或本次传 overwrite=true）。',
            settings: publicSettings(settings),
          };
        }
        fs.writeFileSync(outFile, markdown, 'utf8');
        return {
          ok: true,
          date,
          path: outFile,
          count,
          usedFallbackTemplate: usedFallback,
          settings: publicSettings(settings),
        };
      },
    });

    register({
      name: 'jp_vocab_settings',
      description: '读取或修改日语查词插件的共享配置（输出目录、日界时间、补全模式、是否覆盖、是否按词性分组、模板路径）。修改后宿主与汇总立刻生效。',
      parameters: SETTINGS_PARAMS,
      output: textOutput(SETTINGS_SCHEMA),
      isConcurrencySafe: () => false,
      async execute(raw) {
        const action = raw?.action === 'set' ? 'set' : 'get';
        if (action === 'get') {
          return { ok: true, path: configPath(), config: publicSettings(settingsOf(patchConfig)) };
        }
        const next = writeSharedConfig(raw?.config && typeof raw.config === 'object' ? raw.config : {});
        return { ok: true, path: configPath(), config: publicSettings(next), message: '已写入共享配置' };
      },
    });

    return () => {
      for (const dispose of disposers) {
        try { dispose(); } catch (error) {
          ctx.logger?.warn?.(`[jp-vocab] 卸载工具失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
  }, 'jp-vocab: tools');
}

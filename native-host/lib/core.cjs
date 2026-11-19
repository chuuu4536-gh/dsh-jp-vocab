/**
 * 宿主纯逻辑：不碰 stdio，方便单测（沙箱里 spawn 子进程会被拦）。
 * host.js 只负责「4 字节长度 + JSON」的收发，然后把消息交给 dispatch。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_CONFIG = {
  vocabDir: 'D:\\DSH\\Plugin\\jp-vocab\\vocab',
  summariesDir: 'D:\\DSH\\Plugin\\jp-vocab\\summaries',
  timeZone: 'Asia/Shanghai',
  /** 一天从本地几点开始（0-6）。6 表示 06:00~次日 05:59 算同一天。 */
  dayStartHour: 0,
  /** auto = 生成汇总时先联网补全；manual = 只出草稿。由 agent 侧执行。 */
  enrichMode: 'auto',
  /** 同名 md 已存在时直接覆盖。 */
  overwrite: true,
  /** 汇总按词性分组。 */
  groupByPos: true,
  /** 自定义模板路径，空则用内置模板。 */
  templatePath: '',
};

/** 把任意来源的配置归一化：夹取日界、限定枚举、补齐缺省。 */
function normalizeConfig(raw) {
  const out = { ...DEFAULT_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  const hour = Math.trunc(Number(out.dayStartHour));
  out.dayStartHour = Number.isFinite(hour) ? Math.min(6, Math.max(0, hour)) : 0;
  out.enrichMode = out.enrichMode === 'manual' ? 'manual' : 'auto';
  out.overwrite = out.overwrite !== false;
  out.groupByPos = out.groupByPos !== false;
  out.templatePath = typeof out.templatePath === 'string' ? out.templatePath.trim() : '';
  out.vocabDir = String(out.vocabDir || DEFAULT_CONFIG.vocabDir);
  out.summariesDir = String(out.summariesDir || DEFAULT_CONFIG.summariesDir);
  out.timeZone = String(out.timeZone || DEFAULT_CONFIG.timeZone);
  return out;
}

/** 宿主家目录：默认 ~/.jp-vocab，测试可用 JP_VOCAB_HOME 覆盖。 */
function homeDir(env = process.env) {
  return env.JP_VOCAB_HOME || path.join(os.homedir(), '.jp-vocab');
}

function readConfig(root) {
  try {
    // PowerShell 写的 JSON 带 UTF-8 BOM，直接 JSON.parse 会抛错，
    // 之前就是这里静默回落默认值，导致设置页改的东西从没生效过。
    const text = fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, '');
    return normalizeConfig(JSON.parse(text));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 按配置时区的「业务日期」。
 * 日界不是零点时，先回拨 dayStartHour 小时再取日期。
 */
function localDate(timeZone = DEFAULT_CONFIG.timeZone, now = new Date(), dayStartHour = 0) {
  const hour = Math.min(6, Math.max(0, Math.trunc(Number(dayStartHour)) || 0));
  const shifted = new Date(now.getTime() - hour * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(shifted);
}

/** 配置里的业务日期。 */
function today(config) {
  return localDate(config.timeZone, new Date(), config.dayStartHour);
}

/** 只允许写配置根目录内，挡住 ../ 与绝对路径。 */
function safeJoin(root, name) {
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`路径越界：${target}`);
  }
  return target;
}

function normalizeWord(word) {
  return String(word ?? '').trim().normalize('NFC');
}

/** 天真的 pid 锁：写文件极短，等 800ms 足够。 */
function withLock(file, fn) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 800;
  let fd = null;
  while (Date.now() < deadline) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(lock); } catch { /* ignore */ }
    }
  }
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* 跳过坏行，不让一行脏数据毁掉整天的文件 */ }
  }
  return rows;
}

function vocabFile(config) {
  return safeJoin(path.resolve(config.vocabDir), `${today(config)}.jsonl`);
}

function handleCheck(msg, config) {
  const date = today(config);
  const file = safeJoin(path.resolve(config.vocabDir), `${date}.jsonl`);
  const word = normalizeWord(msg.word);
  const hit = readLines(file).find((r) => normalizeWord(r.word) === word);
  return { ok: true, starred: Boolean(hit), date, count: hit?.count ?? 0 };
}

function toRecord(entry, msg) {
  const e = entry || {};
  return {
    word: normalizeWord(e.word),
    surface: msg.surface ?? normalizeWord(e.word),
    lemmaSource: msg.lemmaSource ?? null,
    candidates: Array.isArray(msg.candidates) ? msg.candidates : [],
    reading: e.reading ?? null,
    romaji: e.romaji ?? null,
    pitch: e.pitch ?? null,
    pitchNumber: e.pitchNumber ?? null,
    pos: Array.isArray(e.pos) ? e.pos : [],
    senses: Array.isArray(e.senses) ? e.senses : [],
    gloss: e.gloss ?? '',
    examples: Array.isArray(e.examples) ? e.examples : [],
    url: e.url ?? null,
    context: msg.context ?? '',
    pageUrl: msg.pageUrl ?? null,
    pageTitle: msg.pageTitle ?? null,
    capturedAt: new Date().toISOString(),
    count: 1,
  };
}

function handleSave(msg, config) {
  const record = toRecord(msg.entry, msg);
  if (!record.word) return { ok: false, error: '空词条' };

  const dir = path.resolve(config.vocabDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = safeJoin(dir, `${today(config)}.jsonl`);

  const result = withLock(file, () => {
    const rows = readLines(file);
    const idx = rows.findIndex((r) => normalizeWord(r.word) === record.word);
    if (idx >= 0) {
      rows[idx] = {
        ...rows[idx],
        count: (rows[idx].count || 1) + 1,
        lastCapturedAt: record.capturedAt,
        // 以首次语境为准：同一词第二次多半是在别的句子里划到的
        context: rows[idx].context || record.context,
      };
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      fs.renameSync(tmp, file);
      return { deduped: true };
    }
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    return { deduped: false };
  });

  return { ok: true, date: today(config), absFile: file, file: path.basename(file), deduped: result.deduped };
}

function handleConfigure(msg, root) {
  const next = normalizeConfig({ ...readConfig(root), ...(msg.config || {}) });
  if (typeof next.vocabDir !== 'string' || !next.vocabDir.trim()) {
    return { ok: false, error: 'vocabDir 不能为空' };
  }
  fs.mkdirSync(path.resolve(next.vocabDir), { recursive: true });
  if (next.summariesDir) fs.mkdirSync(path.resolve(next.summariesDir), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'config.json');
  const tmp = `${file}.tmp`;
  // 写出去不带 BOM：谁写的都能被 JSON.parse 直接读
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { ok: true, config: next };
}

function dispatch(msg, root) {
  const config = readConfig(root);
  switch (msg && msg.type) {
    case 'ping':
      return { ok: true, version: '0.1.0', config, pid: process.pid };
    case 'check':
      return handleCheck(msg, config);
    case 'save':
      return handleSave(msg, config);
    case 'configure':
      return handleConfigure(msg, root);
    default:
      return { ok: false, error: `未知消息类型：${msg && msg.type}` };
  }
}

module.exports = {
  DEFAULT_CONFIG, normalizeConfig, homeDir, readConfig, localDate, today, safeJoin,
  normalizeWord, readLines, handleCheck, handleSave, handleConfigure, dispatch, vocabFile,
};

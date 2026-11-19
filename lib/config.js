/**
 * 配置来源：与本地宿主共享同一份文件 `%USERPROFILE%\.jp-vocab\config.json`。
 *
 * 优先级：共享文件 > cordis.patch.yml 里的 config > 内置默认。
 * 这样扩展设置页改一次，写盘与汇总两边同时生效。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  vocabDir: 'D:\\DSH\\Plugin\\jp-vocab\\vocab',
  summariesDir: 'D:\\DSH\\Plugin\\jp-vocab\\summaries',
  timeZone: 'Asia/Shanghai',
  dayStartHour: 0,
  enrichMode: 'auto',
  overwrite: true,
  groupByPos: true,
  templatePath: '',
};

export function normalizeConfig(raw) {
  const out = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  const hour = Math.trunc(Number(out.dayStartHour));
  out.dayStartHour = Number.isFinite(hour) ? Math.min(6, Math.max(0, hour)) : 0;
  out.enrichMode = out.enrichMode === 'manual' ? 'manual' : 'auto';
  out.overwrite = out.overwrite !== false;
  out.groupByPos = out.groupByPos !== false;
  out.templatePath = typeof out.templatePath === 'string' ? out.templatePath.trim() : '';
  out.vocabDir = String(out.vocabDir || DEFAULTS.vocabDir);
  out.summariesDir = String(out.summariesDir || DEFAULTS.summariesDir);
  out.timeZone = String(out.timeZone || DEFAULTS.timeZone);
  return out;
}

export function configPath() {
  // 与宿主同一套目录约定：JP_VOCAB_HOME 直接指向 .jp-vocab 目录（测试用）
  const dir = process.env.JP_VOCAB_HOME || path.join(os.homedir(), '.jp-vocab');
  return path.join(dir, 'config.json');
}

/** 读共享配置；带 BOM 也能读（PowerShell 写出来的就带）。 */
export function readSharedConfig() {
  try {
    const text = fs.readFileSync(configPath(), 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function resolveConfig(patchConfig = {}) {
  return normalizeConfig({ ...(patchConfig || {}), ...readSharedConfig() });
}

/** 写共享配置（与宿主同一文件、同一套归一化）。 */
export function writeSharedConfig(patch = {}) {
  const next = normalizeConfig({ ...readSharedConfig(), ...(patch || {}) });
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

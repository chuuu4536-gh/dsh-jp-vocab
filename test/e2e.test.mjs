/**
 * 端到端（无浏览器）：词典 HTML → 解析 → 宿主写入 → 读回 → 生成 Markdown。
 * 这条链路是扩展与 DSH 插件之间唯一的接口，两侧改动都要过这个测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEntry, buildUrl } from '../edge-ext/parse.js';
import { readDay, buildSummary, loadTemplate } from '../lib/format.js';

const require = createRequire(import.meta.url);
const core = require('../native-host/lib/core.cjs');

const FIXTURE = path.join(import.meta.dirname, '..', 'edge-ext', 'test', 'fixtures', '勉強.html');
const TEMPLATE = path.join(import.meta.dirname, '..', 'dsh-plugin', 'templates', 'daily-summary.md');

test('选中「勉強」→ 落盘 → 生成当日总结', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jpv-e2e-'));
  const config = { vocabDir: path.join(tmp, 'vocab'), summariesDir: path.join(tmp, 'summaries'), timeZone: 'Asia/Shanghai' };

  // 1. 扩展侧：抓取 + 解析
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const entry = parseEntry(html, { word: '勉強', url: buildUrl('勉強') });
  assert.ok(entry, '解析失败');

  // 2. 宿主侧：写当天 jsonl
  const saved = core.handleSave({
    type: 'save',
    entry,
    context: '彼は毎日勉強している。',
    pageUrl: 'https://example.com/a',
    pageTitle: '示例页',
  }, config);
  assert.equal(saved.ok, true);

  // 3. DSH 插件侧：读回 + 渲染
  const { words } = readDay(config.vocabDir, saved.date);
  assert.equal(words.length, 1);
  assert.equal(words[0].reading, 'べんきょう');

  const { markdown, count } = buildSummary({
    date: saved.date,
    words,
    includeContext: true,
  });
  assert.equal(count, 1);
  assert.match(markdown, /^# \d{4}-\d{2}-\d{2}/);
  assert.match(markdown, /べんきょう（勉強）◎/);
  assert.match(markdown, /- 名·自他·三类：用功学习/);
  assert.match(markdown, /- 原文：彼は毎日勉強している。/);

  // 4. 同词再收藏：计数 +1，不产生第二条
  core.handleSave({ type: 'save', entry, context: '别的句子' }, config);
  assert.equal(readDay(config.vocabDir, saved.date).words.length, 1);
  assert.equal(readDay(config.vocabDir, saved.date).words[0].count, 2);
});

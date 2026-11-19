import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const core = require('../lib/core.cjs');

function makeConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jpvocab-'));
  fs.mkdirSync(path.join(root, 'vocab'), { recursive: true });
  return { root, config: { vocabDir: path.join(root, 'vocab'), summariesDir: path.join(root, 'summaries'), timeZone: 'Asia/Shanghai' } };
}

test('localDate 按配置时区跨零点不错日', () => {
  // 2026-11-17T16:30:00Z = 2026-11-18 00:30（东八区）
  assert.equal(core.localDate('Asia/Shanghai', new Date('2026-11-17T16:30:00Z')), '2026-11-18');
  assert.equal(core.localDate('Asia/Shanghai', new Date('2026-11-17T15:30:00Z')), '2026-11-17');
});

test('safeJoin 拒绝越界路径', () => {
  const { root } = makeConfig();
  assert.ok(core.safeJoin(root, 'a.jsonl').startsWith(path.resolve(root)));
  assert.throws(() => core.safeJoin(root, '../evil.jsonl'), /路径越界/);
});

test('save 写当天文件，重复词只加计数且保留首次语境', () => {
  const { config } = makeConfig();
  const entry = { word: '勉強', reading: 'べんきょう', pitch: '◎', pitchNumber: 0, pos: ['名', '自他'], senses: [{ no: 1, text: '学习' }], examples: ['一夜漬けの勉強。／临阵磨枪。'], url: 'https://dict.asia/jc/勉強' };

  const a = core.handleSave({ type: 'save', entry, context: '彼は毎日勉強している。' }, config);
  assert.equal(a.ok, true);
  assert.equal(a.deduped, false);

  const b = core.handleSave({ type: 'save', entry, context: '（第二次，不应覆盖）' }, config);
  assert.equal(b.deduped, true);

  const rows = fs.readFileSync(a.absFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].context, '彼は毎日勉強している。');
  assert.deepEqual(rows[0].pos, ['名', '自他']);
});

test('check 判断当天是否已收藏', () => {
  const { config } = makeConfig();
  assert.equal(core.handleCheck({ word: '猫' }, config).starred, false);
  core.handleSave({ type: 'save', entry: { word: '猫', reading: 'ねこ' } }, config);
  assert.equal(core.handleCheck({ word: '猫' }, config).starred, true);
});

test('空词条被拒绝，未知类型有明确报错', () => {
  const { config, root } = makeConfig();
  assert.equal(core.handleSave({ type: 'save', entry: {} }, config).ok, false);
  assert.match(core.dispatch({ type: 'nope' }, root).error, /未知消息类型/);
});

test('坏行被跳过，不影响其余词条', () => {
  const { config } = makeConfig();
  const a = core.handleSave({ type: 'save', entry: { word: '犬', reading: 'いぬ' } }, config);
  fs.appendFileSync(a.absFile, '{不是 JSON\n', 'utf8');
  assert.equal(core.handleCheck({ word: '犬' }, config).starred, true, '坏行之后的读取不应崩');
});

test('config.json 带 UTF-8 BOM 也能读出来', () => {
  const { root } = makeConfig();
  fs.writeFileSync(
    path.join(root, 'config.json'),
    `\uFEFF${JSON.stringify({ dayStartHour: 6, enrichMode: 'manual' })}`,
    'utf8',
  );
  const cfg = core.readConfig(root);
  assert.equal(cfg.dayStartHour, 6);
  assert.equal(cfg.enrichMode, 'manual');
});

test('日界 6 点：05:59 算前一天，06:00 算当天', () => {
  assert.equal(core.localDate('Asia/Shanghai', new Date('2026-11-19T05:59:00+08:00'), 6), '2026-11-18');
  assert.equal(core.localDate('Asia/Shanghai', new Date('2026-11-19T06:00:00+08:00'), 6), '2026-11-19');
  assert.equal(core.localDate('Asia/Shanghai', new Date('2026-11-19T05:59:00+08:00'), 0), '2026-11-19');
});

test('configure 会夹取非法日界并归一化枚举', () => {
  const { root } = makeConfig();
  const a = core.handleConfigure({ config: { dayStartHour: 9, enrichMode: '乱写' } }, root);
  assert.equal(a.config.dayStartHour, 6);
  assert.equal(a.config.enrichMode, 'auto');

  const b = core.handleConfigure({ config: { dayStartHour: -3 } }, root);
  assert.equal(b.config.dayStartHour, 0);

  const saved = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  assert.equal(saved.dayStartHour, 0);
});

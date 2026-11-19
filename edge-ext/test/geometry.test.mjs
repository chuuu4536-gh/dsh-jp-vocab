import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { clampTop, clampLeft } = require('../lib/geometry.cjs');
const ROOT = path.join(import.meta.dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

function rule(selector) {
  const m = CSS.match(new RegExp(`\\n\\s*${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `找不到规则 ${selector}`);
  return m[1];
}

test('clampTop：正常位置不动', () => {
  assert.equal(clampTop(200, 300, 800), 200);
});

test('clampTop：底部溢出时上移', () => {
  // 期望 600 + 高 300 = 900 > 800 - 8 → 夹到 492
  assert.equal(clampTop(600, 300, 800), 492);
});

test('clampTop：顶部溢出时贴顶', () => {
  assert.equal(clampTop(-50, 300, 800), 8);
});

test('clampTop：卡片比视口还高时贴顶（交给内部滚动）', () => {
  assert.equal(clampTop(100, 900, 800), 8);
});

test('clampLeft：按锚点居中', () => {
  // 锚点 400 宽 50 中心 425，盒子 360 → 245
  assert.equal(clampLeft(400, 50, 360, 1200), 245);
});

test('clampLeft：右侧越界时左移', () => {
  assert.equal(clampLeft(1100, 60, 360, 1200), 832);
});

test('clampLeft：盒子比视口宽时贴左', () => {
  assert.equal(clampLeft(100, 50, 400, 300), 8);
});

test('布局契约：卡片自己是滚动容器（不能再退回 flex + max-height）', () => {
  const card = rule('\\.card');
  assert.match(card, /overflow-y:\s*auto/, '.card 必须是滚动容器');
  assert.doesNotMatch(card, /display:\s*flex/, '不要再回到 flex 布局：max-height 不会让 flex 子项收缩');
});

test('布局契约：底栏吸底、头部吸顶', () => {
  const foot = rule('\\.foot');
  assert.match(foot, /position:\s*sticky/);
  assert.match(foot, /bottom:\s*0/);

  const head = rule('\\.head');
  assert.match(head, /position:\s*sticky/);
  assert.match(head, /top:\s*0/);
});

test('布局契约：body 不再自己滚动（否则会出现双层滚动）', () => {
  const body = rule('\\.body');
  assert.doesNotMatch(body, /overflow-y:\s*auto/);
});

test('manifest：geometry 必须先于 content.js 注入', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const js = manifest.content_scripts?.[0]?.js ?? [];
  assert.deepEqual(js, ['lib/geometry.cjs', 'content.js']);
});

test('content.js 不再用 opacity 压暗正文文字', () => {
  const textRules = ['\\.reading \\{', '\\.hint-line \\{', '\\.ex-title \\{', '\\.link \\{', '\\.msg \\{', '\\.ex \\{'];
  for (const r of textRules) {
    const m = CSS.match(new RegExp(`${r}[^}]*\\}`));
    assert.ok(m, `没匹配到 ${r}`);
    assert.ok(!/opacity\s*:/.test(m[0]), `${r} 仍在使用 opacity`);
  }
});

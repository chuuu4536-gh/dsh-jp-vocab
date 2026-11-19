/**
 * 配色契约：把 content.js 里的设计变量读出来算 WCAG 对比度。
 * 目的不是"好看"，而是防止以后有人顺手把文字调灰、或者把深色底改浅。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'content.js'), 'utf8');
const [LIGHT, DARK] = CSS.split('@media (prefers-color-scheme: dark)');

function token(block, name) {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `找不到变量 --${name}`);
  return m[1];
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 深色门槛更高：低亮度屏幕上看不清已经有过一次反馈，别悄悄退回去
const THEMES = [
  { name: '浅色', block: LIGHT, body: 7, secondary: 4.5 },
  { name: '深色', block: DARK, body: 12, secondary: 9 },
];

for (const { name, block, body, secondary } of THEMES) {
  test(`${name}模式：正文/例句 ≥ ${body}:1`, () => {
    const ratio = contrast(token(block, 'fg-2'), token(block, 'bg'));
    assert.ok(ratio >= body, `${name} fg-2 对比度 ${ratio.toFixed(1)} 不足 ${body}`);
  });

  test(`${name}模式：次级文字 ≥ ${secondary}:1`, () => {
    const ratio = contrast(token(block, 'fg-3'), token(block, 'bg'));
    assert.ok(ratio >= secondary, `${name} fg-3 对比度 ${ratio.toFixed(1)} 不足 ${secondary}`);
  });

  test(`${name}模式：提示条 ≥ 4.5:1`, () => {
    const ratio = contrast(token(block, 'warn-fg'), token(block, 'warn-bg'));
    assert.ok(ratio >= 4.5, `${name} toast 对比度 ${ratio.toFixed(1)} 不足`);
  });
}

test('深色例句靠字号与行高兜底（≥14px / 有行高）', () => {
  const rule = DARK.match(/\.ex\s*\{[^}]*\}/);
  assert.ok(rule, '深色块里没有 .ex 排版规则');
  const size = Number((rule[0].match(/font-size:\s*(\d+)px/) || [])[1]);
  assert.ok(size >= 14, `.ex 字号 ${size}px 偏小`);
  assert.match(rule[0], /line-height:\s*1\.\d+/, '.ex 缺行高');
});

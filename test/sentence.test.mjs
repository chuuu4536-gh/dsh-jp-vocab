import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceBounds } from '../edge-ext/lib/sentence.js';

test('取到含句末标点的完整句子', () => {
  const text = 'ステージ２は、揺れが収まり通信を含む全てのインフラが停止し、衣食住を確保するまでの期間。次の文。';
  const at = text.indexOf('収まり');
  const s = sentenceBounds(text, at, '収まり'.length);
  assert.ok(s.startsWith('ステージ２は'));
  assert.ok(s.endsWith('期間。'), `实际：${s}`);
});

test('句中已有前一句时，从前一句句号之后开始', () => {
  const text = '前の文。揺れが収まり通信が止まる。後の文。';
  const at = text.indexOf('収まり');
  assert.equal(sentenceBounds(text, at, 3), '揺れが収まり通信が止まる。');
});

test('没有句末标点时取到段落末尾', () => {
  const text = '揺れが収まり通信を含む';
  const at = text.indexOf('収まり');
  assert.equal(sentenceBounds(text, at, 3), '揺れが収まり通信を含む');
});

test('感叹号与问号也截断', () => {
  assert.equal(sentenceBounds('やめろ！次。', 0, 3), 'やめろ！');
  assert.equal(sentenceBounds('本当？次。', 0, 2), '本当？');
});

test('超长句按上限截断', () => {
  const text = `${'あ'.repeat(300)}。`;
  assert.equal(sentenceBounds(text, 10, 2, 50).length, 50);
});

test('下标异常时安全返回', () => {
  assert.equal(sentenceBounds('', 0, 1), '');
  assert.equal(sentenceBounds('短い', -1, 1), '短い');
});

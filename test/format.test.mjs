import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  localDate, readDay, mergeSupplements, render, buildSummary, loadTemplate, posGroup,
} from '../lib/format.js';

const words = [
  {
    word: '勉強', reading: 'べんきょう', pitch: '◎', pitchNumber: 0, pos: ['名', '自他'],
    gloss: '学习', examples: ['一夜漬けの勉強。／临阵磨枪。'], context: '彼は毎日勉強している。',
    url: 'https://dict.asia/jc/勉強',
  },
  { word: '猫', reading: 'ねこ', pitch: '①', pitchNumber: 1, pos: ['名'], gloss: '猫', examples: [], context: '', url: null },
];

test('localDate 按东八区跨零点', () => {
  assert.equal(localDate('Asia/Shanghai', new Date('2026-11-17T16:30:00Z')), '2026-11-18');
});

test('读日文件：不存在返回空，坏行跳过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpv-'));
  assert.deepEqual(readDay(dir, '2026-01-01').words, []);
  fs.writeFileSync(path.join(dir, '2026-01-01.jsonl'), `${JSON.stringify(words[0])}\n{坏行\n`);
  const got = readDay(dir, '2026-01-01');
  assert.equal(got.words.length, 1);
  assert.equal(got.words[0].word, '勉強');
});

test('supplements 按词合并，不覆盖词典已有例句以外的字段', () => {
  const merged = mergeSupplements(words, [{ word: '勉強', collocations: ['勉強になる'], note: '常与「になる」连用' }]);
  assert.equal(merged[0].collocations[0], '勉強になる');
  assert.equal(merged[0].note, '常与「になる」连用');
  assert.equal(merged[1].collocations, undefined);
});

test('模板：循环 + 缺字段回落为 ——', () => {
  const tpl = '{{#words}}[{{no}}] {{word}}/{{reading}}{{pitchText}} {{gloss}}|{{context}}\n{{/words}}';
  const out = render(tpl, { date: '2026-11-17', count: '2', words: words.map((w, i) => ({
    no: String(i + 1), word: w.word, reading: w.reading ?? '', pitchText: '',
    gloss: w.gloss, context: w.context || '—',
  })) });
  assert.match(out, /\[1\] 勉強/);
  assert.match(out, /\[2\] 猫/);
  assert.match(out, /—/);
});

test('buildSummary：空词表要能识别出来', () => {
  const r = buildSummary({ date: '2026-11-17', words: [], template: 'x{{#words}}{{word}}{{/words}}' });
  assert.equal(r.count, 0);
  assert.equal(r.empty, true);
});

test('模板缺失时回落到内置模板并标记', () => {
  const { template, usedFallback } = loadTemplate('D:/definitely/not/here.md');
  assert.equal(usedFallback, true);
  assert.match(template, /今日新词/);
});

test('真实模板能渲染出完整条目', () => {
  const tplPath = path.join(import.meta.dirname, '..', 'templates', 'daily-summary.md');
  const { template } = loadTemplate(tplPath);
  const { markdown } = buildSummary({ date: '2026-11-17', words, template });
  assert.match(markdown, /# 2026-11-17 今日新词/);
  assert.match(markdown, /## 1\. 勉強/);
  assert.match(markdown, /べんきょう/);
  assert.match(markdown, /dict\.asia/);
  assert.match(markdown, /共 2 个词/);
});

test('词性归类', () => {
  assert.equal(posGroup(['名']), '名詞');
  assert.equal(posGroup(['自五']), '動詞');
  assert.equal(posGroup(['他下一']), '動詞');
  assert.equal(posGroup(['形']), '形容詞');
  assert.equal(posGroup(['形動']), '形容動詞');
  assert.equal(posGroup(['副']), '副詞');
  assert.equal(posGroup([]), 'その他');
});

test('按词性分组：排序正确，且每组只出一个标题', () => {
  const tpl = '{{#words}}{{#groupHeading}}[{{groupHeading}}]{{/groupHeading}}{{word}} {{/words}}';
  const out = buildSummary({
    date: '2026-11-18',
    words: [
      { word: '走る', pos: ['自五'] },
      { word: '猫', pos: ['名'] },
      { word: '高い', pos: ['形'] },
      { word: '犬', pos: ['名'] },
    ],
    template: tpl,
    groupByPos: true,
  });
  assert.equal(out.markdown.trim(), '[名詞]猫 犬 [動詞]走る [形容詞]高い');
});

test('不分组时保持原有顺序', () => {
  const tpl = '{{#words}}{{word}} {{/words}}';
  const out = buildSummary({
    date: '2026-11-18',
    words: [{ word: '走る', pos: ['自五'] }, { word: '猫', pos: ['名'] }],
    template: tpl,
    groupByPos: false,
  });
  assert.equal(out.markdown.trim(), '走る 猫');
});

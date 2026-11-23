import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, mergeSupplements, buildSummary, headerLine, chineseGloss, abbrevPos,
  splitExample, splitCollocation, wordBlock,
} from '../lib/format.js';

const word = {
  word: '意地',
  reading: 'いじ',
  pitch: '②',
  pitchNumber: 2,
  pos: ['名'],
  senses: [{ no: 1, text: '心性、性情；固执、倔强。（意地っ張り。）' }],
  gloss: '心性、性情；固执、倔强。（意地っ張り。）',
  collocations: ['意地が悪い（心眼坏、故意刁难）', { jp: '意地を張る', zh: '固执己见' }],
  examples: ['つまらない意地を張るな。／不要固执己见。'],
  context: 'つまらない意地を張るな。',
  url: 'https://dict.asia/jc/意地',
};

test('localDate 按东八区跨零点', () => {
  assert.equal(localDate('Asia/Shanghai', new Date('2026-11-17T16:30:00Z')), '2026-11-18');
});

test('词头：读音（词）音调', () => {
  assert.equal(headerLine(word), 'いじ（意地）②');
  assert.equal(headerLine({ word: '猫', reading: 'ねこ', pitch: '①' }), 'ねこ（猫）①');
  assert.equal(headerLine({ word: '猫', reading: '猫', pitch: '' }), '猫');
});

test('释义只保留中文：删日文括号、保留中文括号', () => {
  assert.equal(chineseGloss('主办；举办。（中心となってあることを催すこと。）'), '主办；举办。');
  assert.equal(chineseGloss('（某种）情况，关系;理由，原因。'), '（某种）情况，关系;理由，原因。');
  assert.equal(chineseGloss('【名・他サ】\n主办；举办。（催すこと。）'), '主办；举办。');
  assert.equal(chineseGloss('（注意：读音为◎）总共;总计。（合計。）'), '总共;总计。');
});

test('词性缩写：异常标签归一为他五·自五，脏标签丢弃', () => {
  assert.equal(abbrevPos(['名']), '名');
  assert.equal(abbrevPos(['他动·自动·一类']), '他五·自五');
  assert.equal(abbrevPos(['名', '他サ】】（注意：读音为◎）（1）……']), '名');
});

test('例句与搭配拆分', () => {
  assert.deepEqual(splitExample('映画の看板。／海报；电影广告。'), { jp: '映画の看板。', zh: '海报；电影广告。' });
  assert.deepEqual(splitExample({ jp: '文', zh: '译文' }), { jp: '文', zh: '译文' });
  assert.deepEqual(splitCollocation('意地が悪い（心眼坏）'), { jp: '意地が悪い', zh: '心眼坏' });
  assert.deepEqual(splitCollocation('意地を張る：固执己见'), { jp: '意地を張る', zh: '固执己见' });
});

test('单词块：标题加粗、例为二级大纲、无空行/备注/链接', () => {
  const block = wordBlock(word, 0);
  const expected = [
    '**いじ（意地）②**',
    '- 名：心性、性情；固执、倔强',
    '- 常见搭配',
    '\t- 意地が悪い：心眼坏、故意刁难',
    '\t- 意地を張る：固执己见',
    '- 例',
    '\t- つまらない**意地**を張るな。（不要固执己见。）',
  ].join('\n');
  assert.equal(block, expected);
  assert.ok(!block.includes('\n\n'), '词内不应有空行');
  assert.ok(!block.includes('http'), '不应出现链接');
});

test('例中加粗：サ変后缀一起包，助词不包', () => {
  const w = {
    word: '主催', reading: 'しゅさい', pitch: '◎', pos: ['名', '他サ'],
    senses: [{ text: '主办；举办。' }],
    examples: ['新聞社が主催する座談会。／报社举办的座谈会。', '…の主催で。／由……主办。'],
  };
  const block = wordBlock(w, 0);
  assert.match(block, /新聞社が\*\*主催する\*\*座談会。/);
  assert.match(block, /…の\*\*主催\*\*で。/);
});

test('有送假名的词按词干+活用加粗', () => {
  const w = { word: '収まる', reading: 'おさまる', pitch: '③', pos: ['自五'], senses: [{ text: '平息。' }], examples: ['揺れが収まり通信が止まる。／晃动平息。'] };
  assert.match(wordBlock(w, 0), /\*\*収まり\*\*通信/);
});

test('假名形态也加粗（指す 的 さして）', () => {
  const w = {
    word: '指す', reading: 'さす', pitch: '①', pos: ['他五'], senses: [{ text: '指。' }],
    examples: ['黒板の字をさして生徒に読ませる。／指着黑板上的字让学生念。'],
  };
  assert.match(wordBlock(w, 0), /字を\*\*さして\*\*生徒/);
});

test('加粗不越过助词（収まりがつく 只包 収まり）', () => {
  const w = {
    word: '収まり', reading: 'おさまり', pitch: '◎', pos: ['名'], senses: [{ text: '平息。' }],
    examples: ['収まりがつく。／得到解决。'],
  };
  assert.match(wordBlock(w, 0), /\*\*収まり\*\*がつく/);
});

test('无送假名词只包词本身与サ変后缀，不吞助词', () => {
  const w = {
    word: '都合', reading: 'つごう', pitch: '◎', pos: ['名'], senses: [{ text: '情况。' }],
    examples: ['何かの都合で休む。／因故休息。', '都合する。／安排。'],
  };
  const block = wordBlock(w, 0);
  assert.match(block, /何かの\*\*都合\*\*で休む/);
  assert.match(block, /\*\*都合する\*\*。/);
});

test('释义过多时收敛到 8 条以内', () => {
  const w = {
    word: '絞る', reading: 'しぼる', pitch: '②', pos: ['他五'],
    senses: Array.from({ length: 8 }, (_, i) => ({ text: `义项${i + 1}。` })),
  };
  const block = wordBlock(w, 0);
  const items = block.split('\n')[1].replace(/^- [^：]*：/, '').split('；').filter(Boolean);
  assert.ok(items.length <= 8, `实际 ${items.length} 条`);
});

test('语境默认不输出，开启后加一行', () => {
  assert.ok(!wordBlock(word, 0).includes('原文'));
  assert.ok(wordBlock(word, 0, { includeContext: true }).includes('- 原文：つまらない意地を張るな。'));
});

test('整篇：日期标题 + 词间一个空行 + 无表格', () => {
  const { markdown, count } = buildSummary({ date: '2026-11-19', words: [word, { ...word, word: '看板', reading: 'かんばん' }] });
  assert.equal(count, 2);
  assert.match(markdown, /^# 2026-11-19\n\n/);
  assert.ok(!markdown.includes('|'), '不应出现表格');
  assert.ok(!markdown.includes('共 '), '不应出现统计行');
  assert.ok(!markdown.includes('dict.asia'), '不应出现链接');
  const gaps = markdown.trim().split('\n\n');
  assert.equal(gaps.length, 3, '应该是 标题 + 两个词块');
});

test('supplements 支持 {jp,zh} 形式', () => {
  const merged = mergeSupplements([word], [{
    word: '意地',
    examples: [{ jp: '意地になる。', zh: '固执起来。' }],
    collocations: [{ jp: '意地っ張り', zh: '固执的人' }],
  }]);
  assert.deepEqual(merged[0].examples[0], { jp: '意地になる。', zh: '固执起来。' });
});

test('按词性分组排序', () => {
  const words = [
    { word: '走る', reading: 'はしる', pitch: '②', pos: ['自五'], senses: [{ text: '跑。' }] },
    { word: '猫', reading: 'ねこ', pitch: '①', pos: ['名'], senses: [{ text: '猫。' }] },
  ];
  const { markdown } = buildSummary({ date: '2026-11-19', words, groupByPos: true });
  assert.ok(markdown.indexOf('ねこ（猫）') < markdown.indexOf('はしる（走る）'));
});

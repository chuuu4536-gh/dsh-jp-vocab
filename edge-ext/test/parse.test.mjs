import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEntry, detectDirection, buildUrl } from '../parse.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const load = (name) => fs.readFileSync(path.join(fixtures, `${name}.html`), 'utf8');

test('勉強：读音/音调/词性/释义/例句齐全', () => {
  const e = parseEntry(load('勉強'), { word: '勉強', url: buildUrl('勉強') });
  assert.equal(e.word, '勉強');
  assert.equal(e.reading, 'べんきょう');
  assert.equal(e.romaji, 'benkyou');
  assert.equal(e.pitch, '◎');
  assert.equal(e.pitchNumber, 0);
  assert.deepEqual(e.pos, ['名', '自他', '三类']);
  assert.equal(e.senses.length, 3);
  assert.match(e.senses[0].text, /用功学习/);
  assert.ok(e.examples.length >= 10, `例句数 ${e.examples.length}`);
  assert.match(e.examples[0], /一夜漬け/);
  assert.equal(e.partial, false);
});

test('食べる：动词音调为②，词性单一', () => {
  const e = parseEntry(load('食べる'), { word: '食べる' });
  assert.equal(e.reading, 'たべる');
  assert.equal(e.pitchNumber, 2);
  assert.equal(e.pos[0], '他下一');
  assert.ok(e.extraPos.length >= 1, '应识别出「相关惯用语/语法」副标题');
});

test('猫：名词，无多义', () => {
  const e = parseEntry(load('猫'));
  assert.equal(e.reading, 'ねこ');
  assert.equal(e.pitchNumber, 1);
  assert.deepEqual(e.pos, ['名']);
  assert.ok(e.senses.length >= 1);
});

test('綺麗：形容动词完整', () => {
  const e = parseEntry(load('綺麗'));
  assert.equal(e.reading, 'きれい');
  assert.ok(e.pos.length >= 1);
  assert.ok(e.gloss.length > 0);
});

test('未命中页面返回 null', () => {
  assert.equal(parseEntry('<html><body>没有结果</body></html>'), null);
});

test('方向判定与 URL 构造', () => {
  // 纯汉字日文词无法靠字符集判定，默认走日中
  assert.equal(detectDirection('勉強'), 'jc');
  assert.equal(detectDirection('たべる'), 'jc');
  assert.equal(detectDirection('勉強', 'cj'), 'cj');
  assert.equal(buildUrl('勉強'), 'https://dict.asia/jc/%E5%8B%89%E5%BC%B7');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { candidatesFromRules, renyouCandidates } from '../lib/lemma-rules.js';
import {
  resolveLemma, buildChain, buildCandidates, deepen, offsetTokens, pickToken,
  verbEvidence, evidenceFromText,
} from '../lib/lemma.js';
import { parseEntry } from '../parse.js';

const ROOT = path.join(import.meta.dirname, '..');

/** Node 侧的 loader：与 SW 的 fetch+DecompressionStream 等价。 */
const loader = {
  async loadArrayBuffer(name) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'dict', name)));
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  },
};

const { builder } = await import(new URL('../vendor/kuromoji.js', import.meta.url).href);
const tokenizer = await builder({ loader }).build();

test('规则：一段/五段/形容词/形容动词', () => {
  const cases = [
    ['食べた', '食べる'],
    ['食べない', '食べる'],
    ['書いた', '書く'],
    ['書かなかった', '書く'],
    ['食べたくなかった', '食べる'],
    ['高かった', '高い'],
    ['静かだった', '静か'],
    ['した', 'する'],
    ['行った', '行く'],
  ];
  for (const [input, expected] of cases) {
    assert.ok(candidatesFromRules(input).includes(expected), `${input} 应给出 ${expected}，实际 ${candidatesFromRules(input)}`);
  }
});

test('规则：原形不产生候选', () => {
  assert.deepEqual(candidatesFromRules('猫'), []);
  assert.equal(candidatesFromRules('食べる').includes('食べる'), false);
});

test('分词：同一表面形按上下文给出不同原形', () => {
  const a = resolveLemma({ surface: '行った', sentence: '東京に行った。', tokenizer });
  const b = resolveLemma({ surface: '行った', sentence: '会議を行った。', tokenizer });
  assert.equal(a.lemma, '行く');
  assert.equal(b.lemma, '行う');
  assert.equal(a.source, 'kuromoji');
});

test('分词：链式活用也能还原', () => {
  assert.equal(resolveLemma({ surface: 'されている', sentence: '問題が指摘されている。', tokenizer }).lemma, 'する');
  assert.equal(resolveLemma({ surface: '食べたくなかった', sentence: 'ケーキは食べたくなかった。', tokenizer }).lemma, '食べる');
});

test('没有分词器时退回规则', () => {
  const r = resolveLemma({ surface: '食べた', sentence: 'ケーキを食べた。' });
  assert.equal(r.lemma, '食べる');
  assert.equal(r.source, 'rule');
});

test('原形词不还原，candidates 只有自己', () => {
  const r = resolveLemma({ surface: '猫', sentence: '猫がいる。', tokenizer });
  assert.equal(r.lemma, '猫');
  assert.equal(r.source, 'none');
});

test('token 偏移量计算与命中', () => {
  const tokens = offsetTokens(tokenizer.tokenize('東京に行った'));
  const sel = '行った';
  const at = '東京に行った'.indexOf(sel);
  const hit = pickToken(tokens, at, at + sel.length);
  assert.equal(hit.surface_form, '行っ');
});

test('活用页能抠出原形', () => {
  const html = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', '食べた.html'), 'utf8');
  const e = parseEntry(html);
  assert.equal(e.isConjugation, true);
  assert.equal(e.baseForm, '食べる');
  assert.equal(e.wordtype, '活用');
});

test('变形链：惹かれて → 惹かれる → 惹く，默认取最深', () => {
  const r = buildChain({ surface: '惹かれて', sentence: '彼の話に惹かれて買った。', tokenizer });
  assert.deepEqual(r.chain, ['惹かれる', '惹く']);
  assert.equal(r.lemma, '惹く');
  assert.equal(r.candidates[0], '惹く');
  assert.ok(r.candidates.includes('惹かれる'));
});

test('变形链：普通动词不再深化，也不产生多余层级', () => {
  const r = buildChain({ surface: '食べて', sentence: 'ケーキを食べて帰る。', tokenizer });
  assert.deepEqual(r.chain, ['食べる']);
  assert.equal(r.lemma, '食べる');
});

test('变形链：复合词「勉強する」保持在词条层，不拆成「する」', () => {
  const r = buildChain({ surface: '勉強する', sentence: '毎日勉強する。', tokenizer });
  assert.equal(r.chain.length, 1);
  assert.equal(r.lemma, '勉強');
  assert.equal(r.candidates.includes('する'), false);
});

test('变形链：没有分词器时，规则层也能再深一层', () => {
  const r = buildChain({ surface: '惹かれる' });
  assert.ok(r.chain.includes('惹く'), `实际 chain=${JSON.stringify(r.chain)}`);
});

test('deepen 对单 token / 非动词返回 null', () => {
  assert.equal(deepen('食べる', tokenizer), null);
  assert.equal(deepen('猫', tokenizer), null);
  assert.equal(deepen('惹かれる', null), null);
});

test('候选过滤：只留词典里查得到的，且不含原选词', () => {
  const got = buildCandidates({
    order: ['惹い', '惹く', '惹かれる', '惹かれて'],
    hit: '惹く',
    surface: '惹かれて',
    verified: ['惹かれる'],
  });
  assert.deepEqual(got, ['惹く', '惹かれる']);
});

test('候选过滤：一个都没验证通过时只剩当前词条', () => {
  const got = buildCandidates({ order: ['惹く', '惹い'], hit: '惹く', surface: '惹かれて', verified: [] });
  assert.deepEqual(got, ['惹く']);
});

test('无分词器：链最多深一层，不会产出假词「惹い」', () => {
  const r = buildChain({ surface: '惹かれて' });
  assert.equal(r.chain.includes('惹い'), false, `实际 chain=${JSON.stringify(r.chain)}`);
  assert.ok(r.chain.length <= 2, `实际 chain=${JSON.stringify(r.chain)}`);
});

test('连用形候选：只给出一个动词原形', () => {
  assert.deepEqual(renyouCandidates('収まり'), ['収まる']);
  assert.deepEqual(renyouCandidates('読み'), ['読む']);
  assert.deepEqual(renyouCandidates('話し'), ['話す']);
  assert.deepEqual(renyouCandidates('猫'), []);
});

test('上下文证据：分词器判为动词 / 前接がをに = strong', () => {
  const tokens = offsetTokens(tokenizer.tokenize('揺れが収まり通信を含む'));
  const idx = tokens.findIndex((t) => t.surface_form === '収まり');
  assert.equal(verbEvidence(tokens, idx), 'strong');

  const t2 = offsetTokens(tokenizer.tokenize('休み時間になった'));
  const i2 = t2.findIndex((t) => t.surface_form === '休み');
  assert.equal(verbEvidence(t2, i2), null); // 句首、名词，无强证据
});

test('文字证据：が 前接 strong，汉字后接 weak，お 前缀不猜', () => {
  assert.equal(evidenceFromText('揺れが収まり通信を含む', '収まり'), 'strong');
  assert.equal(evidenceFromText('休み時間になった', '休み'), 'weak');
  assert.equal(evidenceFromText('お祭り騒ぎが起きた', '祭り'), null);
  assert.equal(evidenceFromText('', '収まり'), null);
});

test('没有分词器时：が+連用形 → 默认动词原形', () => {
  const r = buildChain({ surface: '収まり', sentence: '揺れが収まり通信を含む' });
  assert.equal(r.lemma, '収まる');
  assert.ok(r.candidates.includes('収まり'));
  assert.equal(r.evidence, 'strong');
});

test('没有分词器时：弱证据只加候选，不改默认层', () => {
  const r = buildChain({ surface: '休み', sentence: '休み時間になった' });
  assert.equal(r.lemma, '休み');
  assert.ok(r.candidates.includes('休む'), `实际 candidates=${JSON.stringify(r.candidates)}`);
  assert.equal(r.evidence, 'weak');
});

test('没有分词器时：お祭り 里的 祭り 不补动词', () => {
  const r = buildChain({ surface: '祭り', sentence: 'お祭り騒ぎが起きた' });
  assert.equal(r.lemma, '祭り');
  assert.equal(r.candidates.includes('祭る'), false);
});

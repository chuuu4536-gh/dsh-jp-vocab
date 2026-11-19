/**
 * 词形还原：优先上下文分词（kuromoji），退化到规则。
 *
 * 关键点：**要对整句分词**，不能只切选中的词。
 * 「行った」单看有 行く/行う 两种可能，只有看到前面的「東京に」「会議を」才判得对。
 *
 * 另外提供「变形链」：一个原形本身可能还是另一个词的变形
 * （惹かれる 既是独立词，又是 惹く 的被动），链式还原能一直追到最原本的词。
 */
import { candidatesFromRules } from './lemma-rules.js';

/** kuromoji 的 token 不带偏移量，按表面长度累加补出来。 */
export function offsetTokens(tokens) {
  let at = 0;
  return (tokens || []).map((t) => {
    const start = at;
    at += String(t.surface_form ?? '').length;
    return { ...t, start, end: at };
  });
}

/** 找出覆盖 [start, end) 的那个 token。 */
export function pickToken(tokens, start, end) {
  return (tokens || []).find((t) => t.start < end && t.end > start) || null;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * @param {object} input
 * @param {string} input.surface 用户选中的文字
 * @param {string} [input.sentence] 选中所在的整句（用于上下文消歧）
 * @param {{tokenize(s:string):any[]}} [input.tokenizer]
 * @returns {{lemma:string, source:'kuromoji'|'rule'|'none', candidates:string[]}}
 */
export function resolveLemma({ surface, sentence, tokenizer }) {
  const text = String(surface ?? '').trim();
  const rules = candidatesFromRules(text);

  if (!text) return { lemma: '', source: 'none', candidates: [] };

  let primary = '';
  let source = 'none';

  if (tokenizer && sentence && sentence.includes(text)) {
    try {
      const tokens = offsetTokens(tokenizer.tokenize(sentence));
      const at = sentence.indexOf(text);
      const token = pickToken(tokens, at, at + text.length);
      const base = token?.basic_form;
      if (base && base !== '*' && base !== text) {
        primary = base;
        source = 'kuromoji';
      }
    } catch {
      /* 分词失败就退回规则 */
    }
  }

  if (!primary && rules.length) {
    primary = rules[0];
    source = 'rule';
  }

  if (!primary) return { lemma: text, source: 'none', candidates: [] };

  return {
    lemma: primary,
    source,
    // 顺序：分词结果优先，其次规则，最后原词本身
    candidates: dedupe([primary, ...rules, text]).filter(Boolean).slice(0, 8),
  };
}

/**
 * 把已经还原出来的词再喂回分词器，看它自己是不是还有更上一层。
 *
 * 只在「首 token 是动词、且是这个词的前缀」时才继续，避免把
 * 「勉強する」这类复合词拆成「する」。
 * @param {string} lemma
 * @param {{tokenize(s:string):any[]}|null} tokenizer
 * @returns {string|null}
 */
export function deepen(lemma, tokenizer) {
  if (!tokenizer || !lemma) return null;
  try {
    const tokens = tokenizer.tokenize(lemma);
    if (!Array.isArray(tokens) || tokens.length < 2) return null;
    const head = tokens[0];
    if (head.pos !== '動詞') return null;
    const base = head.basic_form;
    if (!base || base === '*' || base === lemma) return null;
    if (String(head.surface_form ?? '').length >= lemma.length) return null;
    return base;
  } catch {
    return null;
  }
}

/**
 * 构造变形链：浅 → 深。
 *
 * 例：惹かれて → ['惹かれる', '惹く']
 *     食べて   → ['食べる']
 *
 * @param {{surface:string, sentence?:string, tokenizer?:any}} input
 * @returns {{lemma:string, chain:string[], candidates:string[], source:string}}
 */
export function buildChain({ surface, sentence, tokenizer }) {
  const text = String(surface ?? '').trim();
  const base = resolveLemma({ surface: text, sentence, tokenizer });
  if (!base.lemma) return { lemma: '', chain: [], candidates: [], source: 'none' };

  const chain = [base.lemma];

  // 分词器常常一步跳到最深（惹かれて → 惹く），但界面上还想要中间那层。
  // 规则层若给出「再深化正好等于当前层」的候选，就把它补在链首。
  const intermediate = candidatesFromRules(text)
    .filter((c) => c !== base.lemma && deepen(c, tokenizer) === base.lemma)
    .sort((a, b) => b.length - a.length)[0];
  if (intermediate) chain.unshift(intermediate);

  let current = chain[chain.length - 1];
  // 没有分词器时只敢深一层：规则层再往下会把「惹く」变成假形容词「惹い」
  const maxHops = tokenizer ? 2 : 1;

  for (let hop = 0; hop < maxHops; hop += 1) {
    let next = deepen(current, tokenizer);
    // 有分词器时以它为准：规则层再做"深化"容易把 惹く 变成假形容词 惹い
    if (!next && !tokenizer) next = candidatesFromRules(current)[0] ?? null;
    if (!next || chain.includes(next)) break;
    chain.push(next);
    current = next;
  }

  // 默认展示最深一层；候选条按 深 → 浅 排列，最后留原选词兜底
  const deepestFirst = [...chain].reverse();
  return {
    lemma: deepestFirst[0],
    chain,
    candidates: dedupe([...deepestFirst, ...base.candidates, text]).slice(0, 4),
    source: base.source,
  };
}

/**
 * 候选条只留「词典里真能查到」的词。
 *
 * 规则层会产出 惹い 这种日语里不存在的假词，原选词（惹かれて）也不该
 * 出现在候选里——所以在返回给 UI 前用真实查询结果做一次过滤。
 *
 * @param {{order:string[], hit:string, surface:string, verified:string[]}} input
 * @returns {string[]} 深 → 浅，首项是当前词条
 */
export function buildCandidates({ order, hit, surface, verified }) {
  const ok = new Set(verified || []);
  const rest = (order || []).filter((c) => c !== hit && c !== surface && ok.has(c));
  return dedupe([hit, ...rest]);
}

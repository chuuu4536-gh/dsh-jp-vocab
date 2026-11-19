/**
 * 本地活用还原（规则层）。
 *
 * 定位：kuromoji 的兜底。词典没加载完、或词没登录时，用这套规则产出「可能的原形」，
 * 再交给调用方逐个去 dict.asia 验证——**规则不怕多给候选，怕漏**，
 * 因为错误候选会在查词阶段被自然淘汰。
 *
 * 支持多级：先做「链式改写」把 食べたくなかった → 食べたい，再单层还原 → 食べる。
 */

/** 五段动词：あ/い/え/お 段假名 → 对应う段（辞书形词尾）。 */
const A2U = { わ: 'う', か: 'く', が: 'ぐ', さ: 'す', た: 'つ', な: 'ぬ', ば: 'ぶ', ま: 'む', ら: 'る' };
const I2U = { い: 'う', き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', び: 'ぶ', み: 'む', り: 'る' };
const E2U = { え: 'う', け: 'く', げ: 'ぐ', せ: 'す', て: 'つ', ね: 'ぬ', べ: 'ぶ', め: 'む', れ: 'る' };
const O2U = { お: 'う', こ: 'く', ご: 'ぐ', そ: 'す', と: 'つ', の: 'ぬ', ぼ: 'ぶ', も: 'む', ろ: 'る', よ: 'う' };
const ROWS = { A: A2U, I: I2U, E: E2U, O: O2U };

/** 词尾后缀 → 所在段。按长度降序匹配，长的优先。 */
const ROW_SUFFIXES = [
  ['なかった', 'A'], ['なくて', 'A'], ['ない', 'A'],
  ['ませんでした', 'I'], ['ません', 'I'], ['ました', 'I'], ['ます', 'I'],
  ['たかった', 'I'], ['たくない', 'I'], ['たく', 'I'], ['たい', 'I'],
  ['なければ', 'E'], ['れば', 'E'],
  ['ましょう', 'O'], ['よう', 'O'],
  // 被动/可能/使役：惹かれる → 惹く、食べさせる → 食べる
  ['られる', 'A'], ['させる', 'A'], ['れる', 'A'], ['せる', 'A'],
].sort((a, b) => b[0].length - a[0].length);

/** 形容词 / 形容动词：直接换尾。 */
const ADJ_SUFFIXES = [
  ['くなかった', 'い'], ['かった', 'い'], ['くない', 'い'], ['くて', 'い'],
  ['ければ', 'い'], ['かったら', 'い'], ['く', 'い'],
];

const NA_ADJ_SUFFIXES = [
  ['ではなかった', 'だ'], ['じゃなかった', 'だ'],
  ['だった', 'だ'], ['でした', 'だ'], ['ではない', 'だ'], ['じゃない', 'だ'],
];

/** 不规则：直接查表。 */
const IRREGULAR = {
  した: 'する', して: 'する', します: 'する', しない: 'する', しよう: 'する', される: 'する',
  来た: '来る', 来て: '来る', 来ます: '来る', 来ない: '来る', きた: '来る', きて: '来る', きます: 'くる', こない: 'くる',
  行った: '行く', 行って: '行く', 行きます: '行く', 行かない: '行く',
  いった: '行く', いって: '行く',
};

/** 链式改写：把复合后缀压成能继续还原的一层。 */
const CHAINS = [
  ['たくなかった', 'たい'], ['たくない', 'たい'], ['たかった', 'たい'],
  ['ませんでした', 'ません'], ['くなかった', 'い'], ['なかった', 'ない'],
].sort((a, b) => b[0].length - a[0].length);

function tail(stem, map) {
  if (!stem) return null;
  const last = stem[stem.length - 1];
  const dict = map[last];
  return dict ? stem.slice(0, -1) + dict : null;
}

/** て/た/で/だ：看剩余词尾判断。 */
function teTaCandidates(text, suffix) {
  const out = [];
  const stem = text.slice(0, -suffix.length);
  if (!stem) return out;
  const last = stem[stem.length - 1];
  const head = stem.slice(0, -1);
  if (suffix === 'て' || suffix === 'た') {
    if (last === 'っ') out.push(head + 'う', head + 'つ', head + 'る');
    else if (last === 'い') out.push(head + 'く');
    else if (last === 'し') out.push(head + 'す');
    else if (last === 'ん') out.push(head + 'ぬ', head + 'ぶ', head + 'む');
    else out.push(stem + 'る');
  } else if (suffix === 'で' || suffix === 'だ') {
    if (last === 'ん') out.push(head + 'ぬ', head + 'ぶ', head + 'む');
    else if (last === 'い') out.push(head + 'ぐ');
  }
  return out;
}

/** 单层还原（不含链式改写）。 */
function singlePass(text) {
  const out = new Set();

  if (IRREGULAR[text]) out.add(IRREGULAR[text]);

  for (const [suffix, row] of ROW_SUFFIXES) {
    if (!text.endsWith(suffix) || text.length <= suffix.length) continue;
    const stem = text.slice(0, -suffix.length);
    const candidate = tail(stem, ROWS[row]) ?? (stem + 'る');
    if (candidate) out.add(candidate);
  }

  for (const [suffix, replacement] of ADJ_SUFFIXES) {
    if (!text.endsWith(suffix) || text.length <= suffix.length) continue;
    out.add(text.slice(0, -suffix.length) + replacement);
  }

  for (const [suffix, replacement] of NA_ADJ_SUFFIXES) {
    if (!text.endsWith(suffix) || text.length <= suffix.length) continue;
    const stem = text.slice(0, -suffix.length);
    // 形容动词两吃：静かだ / 静か（词典里通常收后者）
    out.add(stem + replacement);
    out.add(stem);
  }

  for (const suffix of ['て', 'た', 'で', 'だ']) {
    if (!text.endsWith(suffix) || text.length <= suffix.length) continue;
    for (const c of teTaCandidates(text, suffix)) out.add(c);
  }

  return [...out].filter((s) => s && s !== text && s.length >= 2);
}

function rewriteOnce(text) {
  for (const [from, to] of CHAINS) {
    if (text.endsWith(from) && text.length > from.length) {
      return text.slice(0, -from.length) + to;
    }
  }
  return null;
}

/**
 * 给出一个词的所有可能原形（未验证）。
 * @param {string} surface 用户选中的词
 * @returns {string[]} 去重后的候选
 */
export function candidatesFromRules(surface) {
  const text = String(surface ?? '').trim();
  if (!text || text.length < 2) return [];

  const found = new Set();
  const seen = new Set([text]);
  let frontier = [text];

  for (let depth = 0; depth < 3; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const candidate of singlePass(current)) {
        found.add(candidate);
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
        }
      }
      const rewritten = rewriteOnce(current);
      if (rewritten && !seen.has(rewritten)) {
        seen.add(rewritten);
        next.push(rewritten);
      }
    }
    frontier = next.slice(0, 16);
    if (!frontier.length) break;
  }

  return [...found].filter((s) => s !== text).slice(0, 10);
}

/** 五段动词连用形词尾 → 辞书形词尾（収まり→収まる、読み→読む…）。 */
const RENYOU_TO_U = { り: 'る', み: 'む', き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', び: 'ぶ' };

/**
 * 连用形候选：只给「一个可能的动词原形」，不作判断。
 * 是否采纳由调用方的上下文证据决定（见 lemma.js 的 verbEvidence）。
 * @param {string} surface
 * @returns {string[]}
 */
export function renyouCandidates(surface) {
  const text = String(surface ?? '').trim();
  if (text.length < 2) return [];
  const dict = RENYOU_TO_U[text[text.length - 1]];
  if (!dict) return [];
  return [text.slice(0, -1) + dict];
}

/**
 * dict.asia HTML → 结构化词条。
 *
 * 设计约束（重要）：本文件**只用字符串与正则**，不依赖 DOM；
 * MV3 的 Service Worker 没有 DOMParser，纯字符串解析让 SW 直接可用，
 * 省掉一个 offscreen document 组件与一轮跨上下文消息。
 *
 * 页面结构（2026-11 实测，服务端渲染）：
 *   <div id="jp_comment"> … <span class="jpword">詞</span>
 *     <span id="kana_0" title="假名">【べんきょう】</span>
 *     <span title="罗马音">【benkyou】</span>
 *     <span class="tone_jp" title="音调">◎</span>
 *     <p class="wordtype">【名•自他•三类】</p>
 *     <span id="comment_0" class="commentItem">释义<br/><p class="liju">…例句<br />…</p>…</span>
 */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&middot;': '·', '&hellip;': '…',
};

/** HTML 实体与标签清理。 */
function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 音调符号 → 数字型（◎ 为平板/0 型）。 */
function pitchToNumber(sym) {
  const s = String(sym ?? '').trim();
  if (!s) return null;
  if (s === '◎') return 0;
  const map = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8 };
  return map[s] ?? null;
}

/** 从一段解释 HTML 里拆出（释义, 例句[]）。 */
function splitSense(commentHtml) {
  const examples = [];
  for (const m of commentHtml.matchAll(/<p\s+class=["']liju["'][^>]*>([\s\S]*?)<\/p>/gi)) {
    for (const line of m[1].split(/<br\s*\/?>/i)) {
      const text = stripTags(line);
      if (text && /[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) examples.push(text);
    }
  }
  const gloss = stripTags(commentHtml.replace(/<p\s+class=["']liju["'][^>]*>[\s\S]*?<\/p>/gi, ' '));
  return { gloss, examples };
}

/**
 * 解析一页词典结果。
 * @param {string} html dict.asia/jc/<词> 的响应正文
 * @param {{word?: string, url?: string}} [meta]
 * @returns {null | Record<string, unknown>} 未命中返回 null
 */
export function parseEntry(html, meta = {}) {
  const source = String(html ?? '');
  if (!source.includes('id="jp_comment"')) return null;

  const blocks = source.split('<div id="jp_comment">').slice(1);
  if (!blocks.length) return null;

  const first = blocks[0];
  const word = stripTags((first.match(/class="jpword"[^>]*>([\s\S]*?)<\/span>/i) ?? [])[1] ?? '');
  if (!word) return null;

  const kana = stripTags((first.match(/id="kana_\d+"[^>]*>【([\s\S]*?)】/i) ?? [])[1] ?? '').replace(/^【|】$/g, '');
  const romaji = stripTags((first.match(/title="罗马音"[^>]*>【([\s\S]*?)】/i) ?? [])[1] ?? '');
  const pitchSymbol = stripTags((first.match(/class=['"]tone_jp['"][^>]*>([\s\S]*?)<\/span>/i) ?? [])[1] ?? '');

  const commentHtml = (first.match(/<span id="comment_\d+" class="commentItem">([\s\S]*?)<\/span>\s*<\/div>/i) ?? [])[1] ?? '';

  // 词性块形如 <p class="wordtype">【名・他サ】（注意：读音为◎）</p>。
  // 不能假设 `】` 紧跟 `</p>`——有的词条在括号后面还有注记，
  // 用 /【(.*?)】<\/p>/ 会一路吞到下一个块，把整段释义当成词性（都合 就是这么坏的）。
  const sectionHtmls = commentHtml.split(/<p\s+class=["']wordtype["'][^>]*>/i).slice(1);
  const sections = sectionHtmls.map((html) => {
    const close = html.indexOf('</p>');
    const head = close >= 0 ? html.slice(0, close) : '';
    const body = close >= 0 ? html.slice(close + 4) : html;
    const headText = stripTags(head);
    const label = (headText.match(/【([\s\S]*?)】/) ?? [])[1] ?? headText;

    // 外来词：词性块里会写【英】infrastructure（或【英】infrastructureの略）
    const langMatch = headText.match(/【(英|仏|独|露|伊|西|中|蘭|ポ|ギ|米)】/);
    let etymology = null;
    if (langMatch) {
      const rest = headText.slice(headText.indexOf(langMatch[0]) + langMatch[0].length);
      const origin = stripTags(rest)
        .replace(/【[^】]*】/g, '')
        .replace(/の略.*$/, '')
        .trim();
      if (origin) etymology = { lang: langMatch[1], word: origin };
    }

    return { label: label.trim(), body, etymology };
  });

  const etymology = sections.find((s) => s.etymology)?.etymology ?? null;

  const wordtypes = sections.map((s) => s.label).filter(Boolean);
  const pos = wordtypes
    .filter((t) => !/相关惯用语|语法/.test(t))
    .flatMap((t) => t.split(/[•・/]/))
    .map((t) => t.trim())
    .filter(Boolean);
  const extraPos = wordtypes.filter((t) => /相关惯用语|语法/.test(t));

  const commentText = stripTags(commentHtml);
  const wordtype = wordtypes[0] ?? '';
  // 活用页会写「…的连用形… → 食べる」，把原形抠出来
  const baseForm = (commentText.match(/→\s*([^\s<、。]+)/) ?? [])[1] ?? '';

  // 按词性块分别拆释义与例句，避免一个块吞掉另一个块
  const pieces = sections.length ? sections : [{ label: '', body: commentHtml }];
  const senses = [];
  const examples = [];
  for (const piece of pieces) {
    const parsed = splitSense(piece.body);
    examples.push(...parsed.examples);
    const matched = [];
    for (const m of parsed.gloss.matchAll(/（(\d+)）([\s\S]*?)(?=（\d+）|$)/g)) {
      const body = m[2].trim();
      if (body) matched.push({ no: Number(m[1]), text: body, pos: piece.label });
    }
    if (!matched.length && parsed.gloss) matched.push({ no: 1, text: parsed.gloss, pos: piece.label });
    senses.push(...matched);
  }

  return {
    word,
    reading: kana || null,
    romaji: romaji || null,
    pitch: pitchSymbol || null,
    pitchNumber: pitchToNumber(pitchSymbol),
    pos,
    extraPos,
    senses,
    // 兼容旧字段
    gloss: senses.map((s) => s.text).join(' / '),
    examples,
    wordTypesRaw: wordtypes,
    wordtype,
    etymology,
    baseForm,
    isConjugation: wordtype === '活用' || wordtypes.includes('活用'),
    url: meta.url ?? null,
    query: meta.word ?? null,
    partial: !kana || !pos.length,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 词典方向。日文词可能全是汉字（勉強・猫），无法靠字符集判定，
 * 所以默认走日中（jc）；只有用户在设置里显式切到中日时才用 cj。
 * @param {string} text
 * @param {'auto'|'jc'|'cj'} [mode]
 */
export function detectDirection(text, mode = 'auto') {
  if (mode === 'jc' || mode === 'cj') return mode;
  return 'jc';
}

/** 构造查询地址。 */
export function buildUrl(word, direction = detectDirection(word)) {
  return `https://dict.asia/${direction}/${encodeURIComponent(String(word).trim())}`;
}

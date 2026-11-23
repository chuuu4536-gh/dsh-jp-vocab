/**
 * 纯逻辑：读当日 JSONL → 合并补充信息 → 套模板 → 出 Markdown。
 * 刻意不依赖任何 DSH/Cordis 模块，便于在本机直接跑单测。
 *
 * 输出格式（1.1.0 起）：
 *   いじ（意地）②
 *   - 名：心性、性情；固执、倔强
 *   - 常见搭配
 *   	- 意地が悪い：心眼坏、故意刁难
 *   - 例句：つまらない意地を張るな。（不要固执己见。）
 * 词内不出现空行，词与词之间一个空行；不使用表格。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TIME_ZONE = 'Asia/Shanghai';
const DASH = '—';

/** 按配置时区的「业务日期」。日界不是零点时，先回拨 dayStartHour 小时再取日期。 */
export function localDate(timeZone = TIME_ZONE, now = new Date(), dayStartHour = 0) {
  const hour = Math.min(6, Math.max(0, Math.trunc(Number(dayStartHour)) || 0));
  const shifted = new Date(now.getTime() - hour * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(shifted);
}

/** 词性分组顺序；未知词性排最后。 */
export const GROUP_ORDER = ['名詞', '動詞', '形容詞', '形容動詞', '副詞', 'その他'];

/** 把 dict.asia 的词性标签（名/自五/他下一/形動…）归到大类。 */
export function posGroup(pos) {
  const head = String((Array.isArray(pos) ? pos[0] : pos) ?? '');
  if (!head) return 'その他';
  if (/形動/.test(head)) return '形容動詞';
  if (/名/.test(head)) return '名詞';
  if (/動|変|五段|一段|自他|他動|自動|[自他][五下一]/.test(head)) return '動詞';
  if (/形/.test(head)) return '形容詞';
  if (/副/.test(head)) return '副詞';
  return 'その他';
}

/** 读某天的词汇文件；文件不存在返回空数组而不是抛错。 */
export function readDay(vocabDir, date) {
  const file = path.join(vocabDir, `${date}.jsonl`);
  if (!fs.existsSync(file)) return { file, words: [] };
  const words = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { words.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
  }
  return { file, words };
}

/** 把 agent 联网补到的信息合并进词条（不覆盖已有非空值以外的字段）。 */
export function mergeSupplements(words, supplements = []) {
  const byWord = new Map();
  for (const s of supplements) {
    if (s && typeof s.word === 'string') byWord.set(s.word.trim(), s);
  }
  return words.map((w) => {
    const s = byWord.get(String(w.word).trim());
    if (!s) return { ...w };
    const pick = (a, b) => (Array.isArray(b) && b.length ? b : a);
    return {
      ...w,
      reading: s.reading || w.reading,
      examples: pick(w.examples, s.examples),
      collocations: s.collocations || w.collocations || [],
      glossOverride: typeof s.gloss === 'string' && s.gloss.trim() ? s.gloss.trim() : w.glossOverride,
      note: s.note || w.note || '',
      supplemented: true,
    };
  });
}

// ---------- 释义清洗 ----------

/** 括号里是不是日文：含假名、或含日文标点。 */
function isJapaneseParen(inner) {
  return /[\u3040-\u30ff]/.test(inner) || /[。、・「」『』]/.test(inner);
}

/**
 * 只保留中文释义：去掉开头的【…】、日文括号/引号段、注意注记、惯用句小节与参照尾注。
 * @param {string} text
 */
export function chineseGloss(text) {
  let s = String(text ?? '');
  // 历史数据里混进的词性前缀
  s = s.replace(/^\s*【[^】]*】\s*/g, '');
  // 惯用句小节：整段丢弃（属于额外备注）
  s = s.replace(/《[^》]*》[\s\S]*$/, '');
  // 日文方括号段〔…〕（词典用来标日文义项）
  s = s.replace(/〔[^〕]*〕/g, '');
  // 括号混用（（…〕）也按日文段处理
  s = s.replace(/[（(][^）)〕]*〕/g, '');
  // 圆括号：日文的删、中文的留（反复处理相邻括号）
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/[（(]([^（）()]*)[）)]/g, (m, inner) => {
      if (/^\s*注意[:：]/.test(inner)) return '';
      return isJapaneseParen(inner) ? '' : m;
    });
  }
  // 日文引号段（「…」「『…』｢…｣）：含假名或日文标点的整段删掉
  // 词典里存在嵌套（「｢…｣の略｡」），反复剥到稳定为止
  prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/[「『｢]([^「『｢」』｣]*)[」』｣]/g, (m, inner) => (isJapaneseParen(inner) ? '' : m));
  }
  // 参照尾注与同义词注记
  s = s.replace(/[⇒][\s\S]*$/, '');
  s = s.replace(/同[：:][^；;。\n]*/g, '');
  s = s.replace(/注意[:：][^。\n]*[。]?/g, '');
  // 引号删掉后可能留下「的略称」这类残句
  s = s.replace(/^[\s，,、]*的?略称[，,]?/, '');
  s = s.replace(/\s+/g, ' ').trim();
  // 括号删掉后可能留下孤立的分隔符
  s = s.replace(/^[；;、,，\s]+|[；;、,，\s]+$/g, '');
  s = s.replace(/[；;]\s*[；;]/g, '；');
  s = s.replace(/[。．]\s*；/g, '；');
  return s.trim();
}

/** 去掉「铝制饭盒.铝制饭盒」这类重复句。 */
export function dedupeSentences(text) {
  const parts = String(text ?? '').split(/[.．。]/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (out[out.length - 1] !== part) out.push(part);
  }
  return out.join('。');
}

/** 词条的中文释义：优先 supplements 覆盖，其次当前 senses，再退回 gloss。 */
export function glossOf(word) {
  if (word.glossOverride) return String(word.glossOverride).replace(/[。．]\s*$/, '');
  const parts = [];
  const push = (text) => {
    const cleaned = dedupeSentences(chineseGloss(text)).replace(/[。．]\s*$/, '').trim();
    if (cleaned && cleaned !== parts[parts.length - 1]) parts.push(cleaned);
  };
  for (const s of word.senses || []) push(s.text);
  if (!parts.length) {
    const raw = word.gloss || '';
    for (const piece of String(raw).split(/\s+\/\s+/)) push(piece);
  }
  return parts.length ? parts.join('；') : DASH;
}

/** 释义过多时收敛：先保前 5 条，再按例句补，硬上限 8 条。 */
export function compressGloss(gloss, examples = [], max = 8) {
  const items = String(gloss ?? '')
    .split('；')
    .map((x) => x.trim())
    .filter(Boolean);
  const uniq = [...new Set(items)];
  if (uniq.length <= 5) return uniq.join('；');
  const picked = uniq.slice(0, 5);
  for (const item of uniq.slice(5)) {
    if (picked.length >= max) break;
    // 例句里用到的义项优先保留（截前两字做关键词）
    const key = item.replace(/^[（(][^）)]*[）)]/, '').slice(0, 2);
    if (key && examples.some((e) => String(e).includes(key))) picked.push(item);
  }
  return picked.join('；');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 送假名动词/形容词的活用尾巴：最多 5 个假名，但遇到助词就停（収まり + が 不能一起加粗）。 */
const INFLECT_TAIL = '(?:(?![がをにはもへやのかねよぞぜ])[ぁ-ん]){1,5}';

/** 无送假名词（名词/サ変）后面可以跟的动词化后缀。 */
const SAHEN_TAIL = '(?:する|した|して|します|しました|しない|される|させる|し|す)?';

/** 纯假名读音在例句里可能出现的活用尾巴（一字符词干也要能匹配）。 */
const KANA_TAIL = '(?:している|してい|して|した|します|しました|しない|される|させる|そう|せば|しろ|し|す)?';

/**
 * 例句里把该词标注出来（Markdown 加粗）。
 *
 * 三种来源都覆盖：
 * 1. 汉字词干 + 后续假名（収まる → 収まり / 指す → 指して）
 * 2. 无送假名词 + する 系列后缀（主催 → 主催する，但 主催で 只包 主催）
 * 3. 读音词干 + 活用尾巴（指す 的例句可能写成「さして」）
 *
 * @param {string} text 例句（日文）
 * @param {string} word 词条
 * @param {string} [reading] 读音（假名）
 */
export function boldWord(text, word, reading = '') {
  const src = String(text ?? '');
  const term = String(word ?? '').trim();
  if (!term) return src;

  const patterns = [];
  // 送假名 = 词尾连续假名；读音按同样长度截断，才能得到真正的词干
  const tail = (term.match(/[ぁ-ん]+$/) ?? [''])[0];
  const kanjiStem = term.slice(0, term.length - tail.length);
  const kanaRaw = String(reading ?? '').trim();
  const kanaStem = kanaRaw.length > tail.length ? kanaRaw.slice(0, kanaRaw.length - tail.length) : '';

  if (kanjiStem && kanjiStem !== term) {
    // 有送假名：词干 + 后续假名
    patterns.push(`${escapeRe(kanjiStem)}${INFLECT_TAIL}`);
  } else if (kanjiStem) {
    // 无送假名：词本身 + 可选的サ変后缀
    patterns.push(`${escapeRe(kanjiStem)}${SAHEN_TAIL}`);
  }

  if (kanaStem) {
    // 读音词干 + 活用尾巴（长词干更可靠；单字词干只允许固定尾巴）
    patterns.push(`${escapeRe(kanaStem)}${KANA_TAIL}`);
  }

  if (!patterns.length) return src;
  // 长的优先，避免先匹配到短片段
  patterns.sort((a, b) => b.length - a.length);
  return src.replace(new RegExp(patterns.join('|'), 'g'), (m) => `**${m}**`);
}

// ---------- 词性缩写 ----------

export const DEFAULT_POS_ABBREV = {
  名: '名', 他五: '他五', 自五: '自五', 他サ: '他サ', 自サ: '自サ',
  自下一: '自下一', 他下一: '他下一', 自他: '自他', 他動: '他動', 自他動: '自他動',
  形: '形', 形動: '形動', 副: '副', 連体: '連体', 接続: '接続', 感動: '感動',
  '名·副': '名·副', '名·サ変他動': '名·サ変他動',
  '他动·自动·一类': '他五·自五', '自他动·一类': '他五·自五',
};

/**
 * 词性缩略：查表，未收录的原样保留；明显是脏数据（过长）的直接丢弃。
 * @param {string[]} pos
 * @param {Record<string,string>} [map]
 */
export function abbrevPos(pos, map = DEFAULT_POS_ABBREV) {
  const out = [];
  for (const raw of pos || []) {
    const key = String(raw ?? '').trim();
    if (!key || key.length > 12) continue;
    out.push(map[key] ?? key);
  }
  return out.join('·');
}

export function loadPosAbbrev(file) {
  if (!file) return DEFAULT_POS_ABBREV;
  try {
    return { ...DEFAULT_POS_ABBREV, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return DEFAULT_POS_ABBREV;
  }
}

// ---------- 例句 / 搭配 ----------

/** 词典例句是「日文／中文」，拆成两部分。 */
export function splitExample(value) {
  if (value && typeof value === 'object') {
    return { jp: String(value.jp ?? value.text ?? '').trim(), zh: String(value.zh ?? value.translation ?? '').trim() };
  }
  const s = String(value ?? '').trim();
  const m = s.match(/^(.+?)[／/](.+)$/);
  return m ? { jp: m[1].trim(), zh: m[2].trim() } : { jp: s, zh: '' };
}

/** 搭配：支持 {jp,zh}、"日文：中文"、"日文（中文）"、纯日文。 */
export function splitCollocation(value) {
  if (value && typeof value === 'object') {
    return { jp: String(value.jp ?? value.text ?? '').trim(), zh: String(value.zh ?? '').trim() };
  }
  const s = String(value ?? '').trim();
  const paren = s.match(/^(.+?)[（(](.+)[）)]$/);
  if (paren) return { jp: paren[1].trim(), zh: paren[2].trim() };
  const colon = s.match(/^(.+?)[：:]\s*(.+)$/);
  if (colon) return { jp: colon[1].trim(), zh: colon[2].trim() };
  return { jp: s, zh: '' };
}

// ---------- 单词语块 ----------

const MAX_EXAMPLES = 3;

/** 片假名（含长音/中点）词条：标题只写片假名 + 音调，不写读音。 */
export function isKatakana(term) {
  return /^[ァ-ヴー・ヽヾ]+$/.test(String(term ?? '').trim());
}

/** 词头：读音（词）音调；片假名词只写词；没有读音或与词相同时只写词。 */
export function headerLine(word) {
  const reading = String(word.reading ?? '').trim();
  const term = String(word.word ?? '').trim();
  const pitch = String(word.pitch ?? '').trim();
  const head = (!isKatakana(term) && reading && reading !== term) ? `${reading}（${term}）` : term;
  return pitch ? `${head}${pitch}` : head;
}

/** 单个词的 Markdown 块（内部不出现空行）。 */
export function wordBlock(word, index, options = {}) {
  const { includeContext = false, posAbbrev = DEFAULT_POS_ABBREV } = options;
  const lines = [`**${headerLine(word)}**`];

  const pos = abbrevPos(word.pos, posAbbrev);
  const examplePairs = (word.examples || []).map(splitExample).filter((e) => e.jp);
  // 人工给定的释义（supplements.gloss）不再二次收敛
  const gloss = word.glossOverride
    ? glossOf(word)
    : compressGloss(glossOf(word), examplePairs.map((e) => e.jp));
  // 外来词在释义前标出借词来源，如（英infrastructure）
  const etym = word.etymology?.word
    ? `（${word.etymology.lang ?? ''}${word.etymology.word}）`
    : '';
  lines.push(`- ${pos ? `${pos}：` : ''}${etym}${gloss}`);

  const collocations = (word.collocations || []).map(splitCollocation).filter((c) => c.jp);
  if (collocations.length) {
    lines.push('- 常见搭配');
    for (const c of collocations) {
      lines.push(`\t- ${c.jp}${c.zh ? `：${c.zh}` : ''}`);
    }
  }

  const examples = examplePairs.slice(0, MAX_EXAMPLES);
  if (examples.length) {
    lines.push('- 例');
    for (const ex of examples) {
      lines.push(`\t- ${boldWord(ex.jp, word.word, word.reading)}${ex.zh ? `（${ex.zh}）` : ''}`);
    }
  }

  if (includeContext) {
    const context = String(word.context ?? '').replace(/\s+/g, ' ').trim();
    if (context) lines.push(`- 原文：${context}`);
  }

  return lines.join('\n');
}

// ---------- 模板 ----------

/** 读模板文件；缺失时返回 null（由调用方使用内置版式）。 */
export function loadTemplate(templatePath) {
  if (!templatePath) return { template: null, usedFallback: false };
  try {
    return { template: fs.readFileSync(templatePath, 'utf8'), usedFallback: false };
  } catch {
    return { template: null, usedFallback: true };
  }
}

/** 内置版式：只有日期标题，词与词之间一个空行。 */
export function defaultDocument(date, blocks) {
  return `# ${date}\n\n${blocks.join('\n\n')}\n`;
}

function renderRaw(template, data) {
  const withSections = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_m, key, body) => {
      const value = data[key];
      if (Array.isArray(value)) {
        return value.length ? value.map((item) => renderRaw(body, { ...data, ...item })).join('') : '';
      }
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value).trim() ? renderRaw(body, data) : '';
      }
      return '';
    },
  );
  return withSections.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** 极简模板引擎：{{var}} 与 {{#section}}…{{/section}}（数组循环 / 标量真值渲染一次）。 */
export function render(template, data) {
  return `${renderRaw(template, data).replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** 自定义模板可用的扁平视图。 */
export function toView(word, index) {
  return {
    no: String(index + 1),
    header: headerLine(word),
    word: String(word.word ?? ''),
    reading: String(word.reading ?? ''),
    pitch: String(word.pitch ?? ''),
    posText: abbrevPos(word.pos),
    gloss: glossOf(word),
  };
}

export function buildSummary({
  date, words, template = null, groupByPos = false, includeContext = false, posAbbrev = DEFAULT_POS_ABBREV,
}) {
  let ordered = words;
  if (groupByPos) {
    ordered = [...words].sort((a, b) => GROUP_ORDER.indexOf(posGroup(a.pos)) - GROUP_ORDER.indexOf(posGroup(b.pos)));
  }

  const blocks = ordered.map((w, i) => wordBlock(w, i, { includeContext, posAbbrev }));
  const markdown = template
    ? render(template, {
      date,
      count: String(blocks.length),
      words: ordered.map((w, i) => ({ ...toView(w, i), block: blocks[i] })),
    })
    : defaultDocument(date, blocks);

  return { markdown, count: blocks.length, empty: blocks.length === 0 };
}

/**
 * 纯逻辑：读当日 JSONL → 合并补充信息 → 套模板 → 出 Markdown。
 * 刻意不依赖任何 DSH/Cordis 模块，便于在本机直接跑单测。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TIME_ZONE = 'Asia/Shanghai';
const DASH = '—';

/**
 * 按配置时区的「业务日期」。
 * 日界不是零点时，先回拨 dayStartHour 小时再取日期。
 */
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
      note: s.note || w.note || '',
      supplemented: true,
    };
  });
}

function or(value, fallback = DASH) {
  if (Array.isArray(value)) return value.length ? value.join('；') : fallback;
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

/** 词条 → 模板可直接引用的扁平视图。 */
export function toView(word, index) {
  const pitch = word.pitch
    ? `（${word.pitch}${word.pitchNumber != null ? ` · ${word.pitchNumber}型` : ''}）`
    : '';
  const examples = (word.examples || []).slice(0, 5);
  return {
    no: String(index + 1),
    word: or(word.word),
    reading: or(word.reading, ''),
    pitch: or(word.pitch, ''),
    pitchNumber: word.pitchNumber != null ? String(word.pitchNumber) : '',
    pitchText: pitch,
    posText: or(word.pos),
    gloss: or(word.gloss || (word.senses || []).map((s) => s.text).join('；')),
    examplesText: examples.length ? examples.map((e) => `  - ${e}`).join('\n') : `  - ${DASH}`,
    context: or(word.context),
    url: or(word.url, ''),
    note: or(word.note, ''),
    collocationsText: or(word.collocations, ''),
  };
}

/** 渲染主体（不做出入裁剪）；递归时用它，避免每层都追加换行。 */
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

export const FALLBACK_TEMPLATE = `# {{date}} 今日新词

共 {{count}} 个词。

{{#words}}
## {{no}}. {{word}}

- 读音：{{reading}}{{pitchText}}
- 词性：{{posText}}
- 释义：{{gloss}}
- 原文：{{context}}
- 词典：{{url}}

{{/words}}`;

/** 读模板文件；缺失时用内置 fallback，并在返回值里标注。 */
export function loadTemplate(templatePath) {
  try {
    return { template: fs.readFileSync(templatePath, 'utf8'), usedFallback: false };
  } catch {
    return { template: FALLBACK_TEMPLATE, usedFallback: true };
  }
}

export function buildSummary({ date, words, template, groupByPos = false }) {
  let ordered = words;
  let groups = [];
  if (groupByPos) {
    const pairs = words
      .map((w) => ({ w, g: posGroup(w.pos) }))
      .sort((a, b) => GROUP_ORDER.indexOf(a.g) - GROUP_ORDER.indexOf(b.g));
    ordered = pairs.map((p) => p.w);
    groups = pairs.map((p) => p.g);
  }

  let lastGroup = '';
  const views = ordered.map((w, i) => {
    const view = toView(w, i);
    view.groupHeading = groupByPos && groups[i] !== lastGroup ? groups[i] : '';
    if (view.groupHeading) lastGroup = view.groupHeading;
    return view;
  });

  const markdown = render(template, {
    date,
    count: String(views.length),
    words: views,
  });
  return {
    markdown,
    count: views.length,
    empty: views.length === 0,
  };
}

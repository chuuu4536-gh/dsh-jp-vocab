/**
 * 句子边界：抓取包含选中词的完整句子（到「。」「！」「？」为止）。
 * 内容脚本是经典脚本、不能 import，content.js 里有一份等价内联实现；
 * 这里只用于单测。
 */

const END = /[。．！？!?]/;

/**
 * @param {string} text 所在元素的文本
 * @param {number} at 选中词在 text 中的起始下标
 * @param {number} len 选中词长度
 * @param {number} [limit] 最大长度
 * @returns {string}
 */
export function sentenceBounds(text, at, len, limit = 200) {
  const s = String(text ?? '');
  if (at < 0 || at >= s.length) return s.slice(0, limit).trim();

  let start = at;
  while (start > 0 && !END.test(s[start - 1])) start -= 1;

  let end = at + Math.max(0, len);
  while (end < s.length && !END.test(s[end])) end += 1;
  if (end < s.length) end += 1; // 含句末标点

  return s.slice(start, end).trim().slice(0, limit);
}

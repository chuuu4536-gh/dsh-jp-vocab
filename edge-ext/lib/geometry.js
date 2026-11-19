/**
 * 浮层定位的纯几何函数（ESM，供单测直接 import）。
 *
 * 内容脚本是经典脚本、不能用 import，所以 content.js 里保留了一份等价的内联实现；
 * 这里的版本只用于验证夹取逻辑本身。
 */

/**
 * 把浮层的 top 夹在视口内。
 * @param {number} desiredTop 期望位置
 * @param {number} boxHeight 浮层实测高度
 * @param {number} viewportHeight 视口高度
 * @param {number} [pad] 边距
 * @returns {number}
 */
export function clampTop(desiredTop, boxHeight, viewportHeight, pad = 8) {
  const max = viewportHeight - boxHeight - pad;
  if (!Number.isFinite(max) || max < pad) return pad; // 空间不够：贴顶，交给内部滚动
  return Math.min(Math.max(desiredTop, pad), max);
}

/**
 * 把浮层的 left 夹在视口内（按中心点对齐锚点）。
 * @param {number} anchorLeft 锚点左边
 * @param {number} anchorWidth 锚点宽度
 * @param {number} boxWidth 浮层宽度
 * @param {number} viewportWidth 视口宽度
 * @param {number} [pad] 边距
 */
export function clampLeft(anchorLeft, anchorWidth, boxWidth, viewportWidth, pad = 8) {
  const desired = anchorLeft + anchorWidth / 2 - boxWidth / 2;
  const max = viewportWidth - boxWidth - pad;
  if (max < pad) return pad;
  return Math.min(Math.max(desired, pad), max);
}

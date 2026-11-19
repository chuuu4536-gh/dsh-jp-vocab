/**
 * 浮层定位的纯几何函数。
 *
 * 同时给两种运行环境用：
 *  - 内容脚本（经典脚本，无模块系统）→ 挂到 globalThis.__jpVocabGeometry
 *  - 单测（Node，CommonJS）→ module.exports
 *
 * 之所以单独成文件：这段夹取逻辑最容易出错（卡片高过视口、锚点贴着顶边），
 * 抽出来才能不靠浏览器就把它测掉。
 */
(function attach(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.__jpVocabGeometry = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
  /**
   * 把浮层的 top 夹在视口内。
   * @param {number} desiredTop 期望位置
   * @param {number} boxHeight 浮层实测高度
   * @param {number} viewportHeight 视口高度
   * @param {number} [pad] 边距
   * @returns {number}
   */
  function clampTop(desiredTop, boxHeight, viewportHeight, pad = 8) {
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
  function clampLeft(anchorLeft, anchorWidth, boxWidth, viewportWidth, pad = 8) {
    const desired = anchorLeft + anchorWidth / 2 - boxWidth / 2;
    const max = viewportWidth - boxWidth - pad;
    if (max < pad) return pad;
    return Math.min(Math.max(desired, pad), max);
  }

  return { clampTop, clampLeft };
});

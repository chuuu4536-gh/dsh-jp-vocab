/**
 * kuromoji 懒加载（Service Worker 版本）。
 *
 * MV3 的 SW 没有 Node 的 zlib，但 Chromium 有 DecompressionStream；
 * 词典文件随扩展打包，用 chrome.runtime.getURL 取（同源，不需要 web_accessible_resources）。
 */
const DICT_DIR = 'dict/';
let pending = null;

/** 读一个 .dat.gz 并解压成 ArrayBuffer。 */
async function loadArrayBuffer(name) {
  const url = chrome.runtime.getURL(DICT_DIR + name);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`词典文件读取失败：${name} (${res.status})`);
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/**
 * 取得分词器；并发调用共享同一次构建，失败返回 null（调用方退到规则层）。
 * @param {{timeoutMs?: number}} [options]
 */
export function getTokenizer({ timeoutMs = 8000 } = {}) {
  if (!pending) {
    pending = (async () => {
      const mod = await import(chrome.runtime.getURL('vendor/kuromoji.js'));
      const builder = mod.builder || mod.default?.builder;
      if (typeof builder !== 'function') throw new Error('kuromoji 入口不可用');
      const built = await builder({ loader: { loadArrayBuffer } }).build();
      return built;
    })().catch((error) => {
      console.warn('[jp-vocab] 分词器不可用，退回规则还原：', error?.message || error);
      pending = null; // 下次再试
      return null;
    });

    const timer = setTimeout(() => {
      // 超时不取消构建（让它继续），只是不再等它
      console.warn('[jp-vocab] 分词器构建超时，本次先用规则');
    }, timeoutMs);
    pending.finally(() => clearTimeout(timer));
  }
  return pending;
}

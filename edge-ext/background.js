/**
 * Service Worker：词形还原 → 查词 → 星标落盘。
 *
 * 为什么解析放 SW：content script 直接 fetch dict.asia 会被页面 CORS 拦，
 * 而 SW + host_permissions 不受同源限制；parse.js 是纯字符串实现，
 * SW 没有 DOMParser 也能跑。
 */
import { parseEntry, buildUrl } from './parse.js';
import { buildChain, buildCandidates } from './lib/lemma.js';
import { getTokenizer } from './lib/tokenizer.js';

const HOST_NAME = 'asia.dict.japanese.lookup';
const CACHE_TTL = 10 * 60 * 1000;
/** @type {Map<string, {at:number, entry:object|null}>} */
const cache = new Map();

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

async function loadSettings() {
  const defaults = { direction: 'auto', maxExamples: 5 };
  try {
    return { ...defaults, ...(await chrome.storage.sync.get(defaults)) };
  } catch {
    return defaults;
  }
}

/** 抓一个词并解析；网络错误抛出，未命中返回 null。 */
async function fetchEntry(word) {
  const key = String(word).trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.entry;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(buildUrl(key, 'jc'), {
      signal: controller.signal,
      credentials: 'omit',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entry = parseEntry(await res.text(), { word: key, url: buildUrl(key, 'jc') });
    cache.set(key, { at: Date.now(), entry });
    return entry;
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '查询超时' : String(error.message || error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 还原 + 查询。候选按「深 → 浅」顺序试，命中即止。
 *
 * exact=true 时跳过还原（用户在候选条上明确点了某一层），
 * 否则点「惹かれる」会被立刻再深化回「惹く」。
 */
async function resolveAndLookup(word, sentence, exact = false, presetTokenizer = null) {
  const settings = await loadSettings();
  const surface = String(word || '').trim();
  if (!surface) return null;

  let tokenizer = presetTokenizer;
  let deferred = false;
  if (!exact && !tokenizer) {
    try {
      // 不再干等 1.5s：给 250ms，拿不到就先用规则层出结果，就绪后再升级
      tokenizer = await withTimeout(getTokenizer(), 250);
    } catch {
      tokenizer = null;
    }
    if (!tokenizer) deferred = true;
  }

  const built = exact
    ? { lemma: surface, chain: [surface], candidates: [surface], source: 'exact' }
    : buildChain({ surface, sentence, tokenizer });

  const order = [...new Set([built.lemma, ...built.candidates])].filter(Boolean).slice(0, 4);

  // 先按「深 → 浅」找到第一个真能查到的词条
  let hit = null;
  let hitEntry = null;
  for (const candidate of order) {
    const entry = await fetchEntry(candidate);
    if (!entry) continue;
    hit = candidate;
    hitEntry = entry;
    break;
  }

  if (!hit) {
    return {
      entry: null, lemma: built.lemma, lemmaSource: built.source,
      surface, candidates: [built.lemma].filter(Boolean), chain: built.chain, settings, deferred,
    };
  }

  // 站点自己的活用页：跟着「→ 原形」再查一次
  if (hitEntry.isConjugation && hitEntry.baseForm && hitEntry.baseForm !== hit) {
    const baseEntry = await fetchEntry(hitEntry.baseForm);
    if (baseEntry) {
      hit = hitEntry.baseForm;
      hitEntry = baseEntry;
    }
  }

  // 其余候选要逐个验证：规则层会产出「惹い」这种词典里没有的假词，
  // 原选词（惹かれて）也不该混进候选条。
  const rest = order.filter((c) => c !== hit && c !== surface).slice(0, 2);
  const verified = [];
  await Promise.all(rest.map(async (c) => {
    try {
      const entry = await fetchEntry(c);
      if (entry && !entry.isConjugation) verified.push(c);
    } catch {
      /* 查不到就当它不存在 */
    }
  }));

  const candidates = buildCandidates({ order, hit, surface, verified });
  return {
    entry: hitEntry,
    lemma: hit,
    lemmaSource: built.source,
    surface,
    candidates,
    chain: [...candidates].reverse(),
    settings,
    deferred,
  };
}

/** 宿主不可用时先暂存，避免用户点了星却什么也没发生。 */
async function queuePending(item) {
  const { pending = [] } = await chrome.storage.local.get({ pending: [] });
  pending.push(item);
  await chrome.storage.local.set({ pending: pending.slice(-200) });
  return pending.length;
}

async function saveEntry(payload) {
  try {
    const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'save', ...payload });
    if (res && res.ok) return { ok: true, date: res.date, file: res.file, deduped: res.deduped };
    return { ok: false, reason: res?.error || '宿主返回失败' };
  } catch (error) {
    const queued = await queuePending(payload);
    return { ok: false, queued, reason: `本地宿主未就绪（${String(error.message || error)}），已暂存 ${queued} 条` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'lookup') {
      try {
        const result = await resolveAndLookup(msg.word, msg.sentence, Boolean(msg.exact));
        if (!result?.entry) {
          return sendResponse({
            ok: false,
            reason: '未收录该词',
            lemma: result?.lemma,
            candidates: result?.candidates || [],
          });
        }
        sendResponse({ ok: true, ...result });

        // 分词器还没就绪：立刻给规则层结果，就绪后重算一次并推给页面
        if (result.deferred && msg.requestId && sender?.tab?.id) {
          getTokenizer()
            .then(async (tk) => {
              if (!tk) return;
              const better = await resolveAndLookup(msg.word, msg.sentence, Boolean(msg.exact), tk);
              if (!better?.entry) return;
              const changed = better.lemma !== result.lemma
                || better.entry.word !== result.entry.word
                || (better.candidates || []).join('|') !== (result.candidates || []).join('|');
              if (!changed) return;
              chrome.tabs.sendMessage(sender.tab.id, {
                type: 'jp-vocab:upgrade',
                requestId: msg.requestId,
                result: better,
              });
            })
            .catch(() => {});
        }
      } catch (error) {
        sendResponse({ ok: false, reason: String(error.message || error) });
      }
      return;
    }
    if (msg?.type === 'check') {
      try {
        const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'check', word: String(msg.word || '') });
        sendResponse({ ok: Boolean(res?.ok), starred: Boolean(res?.starred) });
      } catch {
        sendResponse({ ok: false, starred: false });
      }
      return;
    }
    if (msg?.type === 'save') {
      sendResponse(await saveEntry(msg.payload || {}));
      return;
    }
    if (msg?.type === 'configure') {
      try {
        const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'configure', config: msg.config });
        sendResponse(res || { ok: false, reason: '宿主无响应' });
      } catch (error) {
        sendResponse({ ok: false, reason: String(error.message || error) });
      }
      return;
    }
    if (msg?.type === 'ping') {
      try {
        const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'ping' });
        sendResponse({ ok: Boolean(res?.ok), host: res });
      } catch (error) {
        sendResponse({ ok: false, reason: String(error.message || error) });
      }
      return;
    }
    sendResponse({ ok: false, reason: 'unknown message' });
  })();
  return true;
});

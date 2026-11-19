/**
 * 内容脚本：选区 → 查词按钮 → 结果卡 → 星标收藏。
 *
 * 所有 UI 都在一个 Shadow Root 里，避免被宿主页面 CSS 污染，
 * 也避免我们的样式污染页面。事件在 window 捕获阶段监听，覆盖 iframe 外的普通网页。
 */
(() => {
  if (window.__jpVocabInjected) return;
  window.__jpVocabInjected = true;

  /** 构建号：改了样式后用它确认浏览器跑的是新代码，而不是旧缓存。 */
  const BUILD = '0.6.0';

  const MAX_SELECTION = 24;   // 超过这个长度当句子处理，不弹查词
  const MIN_SELECTION = 1;
  const KANA = /[\u3040-\u30ff]/;
  const HAN = /[\u4e00-\u9fff]/;
  const DEBOUNCE = 120;

  // 定位夹取逻辑内联在此，避免依赖额外注入的文件
  const GEOM = {
    clampTop(desiredTop, boxHeight, viewportHeight, pad = 8) {
      const max = viewportHeight - boxHeight - pad;
      return max < pad ? pad : Math.min(Math.max(desiredTop, pad), max);
    },
    clampLeft(anchorLeft, anchorWidth, boxWidth, viewportWidth, pad = 8) {
      const desired = anchorLeft + anchorWidth / 2 - boxWidth / 2;
      const max = viewportWidth - boxWidth - pad;
      return max < pad ? pad : Math.min(Math.max(desired, pad), max);
    },
    cardBox(position, anchorRect, boxWidth, viewportWidth, pad = 16) {
      if (position === 'top-right') {
        return { left: viewportWidth - boxWidth - pad, top: pad };
      }
      const left = this.clampLeft(anchorRect.left, anchorRect.width, boxWidth, viewportWidth, 8);
      const top = anchorRect.top - 44 < 8 ? anchorRect.bottom + 8 : anchorRect.top - 44;
      return { left, top };
    },
  };
  /** @type {'idle'|'pill'|'card'} */
  let stage = 'idle';
  let currentWord = '';
  let currentEntry = null;
  let currentContext = '';
  let currentCandidates = [];
  let currentChain = [];
  let currentSource = 'none';
  let starred = false;
  let anchorRect = null;
  let debounceTimer = 0;
  let lastSelectionText = '';
  /** 本次查词的请求 id：用于把「分词器就绪后」的升级结果对回同一张卡片 */
  let currentRequestId = '';
  /** 结果卡位置：'top-right'（默认，网页右上角）| 'anchor'（所选词旁边） */
  let cardPosition = 'top-right';

  const host = document.createElement('div');
  host.id = '__jp_vocab_host__';
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; pointer-events: auto; font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      --fg: #1a1a1a; --fg-2: #3d3d3d; --fg-3: #5a5a5a;
      --bg: #ffffff; --bg-elev: #f5f5f6; --line: rgba(0,0,0,.12);
      --accent: #247bbf; --accent-soft: rgba(36,123,191,.12); --accent-line: rgba(36,123,191,.45);
      --warn-fg: #7a4f00; --warn-bg: #fff4d6;
      color-scheme: light dark;
      color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,.16); }
    @media (prefers-color-scheme: dark) {
      .layer { --fg: #f5f5f5; --fg-2: #ececec; --fg-3: #d4d4d4;
        --bg: #1a1a1c; --bg-elev: #242428; --line: rgba(255,255,255,.18);
        --accent: #8cc4ef; --accent-soft: rgba(140,196,239,.20); --accent-line: rgba(140,196,239,.55);
        --warn-fg: #f6c765; --warn-bg: #3a3118;
        box-shadow: 0 12px 32px rgba(0,0,0,.55); }
      /* 低亮度屏幕上看不清，靠字号/行高而不只是颜色 */
      .ex { font-size: 14px; line-height: 1.75; font-weight: 450; }
    }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px;
      font-size: 13px; font-weight: 600; cursor: pointer; user-select: none; }
    .pill:hover { background: rgba(36,123,191,.12); }
    .pill svg { width: 14px; height: 14px; }
    .card { width: min(360px, calc(100vw - 16px)); max-height: min(70vh, calc(100vh - 16px));
      overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
    .head { padding: 12px 14px 8px; position: sticky; top: 0; z-index: 2; background: var(--bg); }
    .word { font-size: 22px; font-weight: 700; letter-spacing: .5px; }
    .reading { font-size: 13px; color: var(--fg-3); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .pitch { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); }
    .hint-line { font-size: 11px; color: var(--fg-3); margin-top: 2px; }
    .chain { font-size: 11px; color: var(--fg-3); margin-top: 2px; }
    .chain b { color: var(--fg); font-weight: 600; }
    .cands { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .cand { font-size: 12px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--accent-line);
      background: transparent; color: inherit; cursor: pointer; font-family: inherit; }
    .cand:hover { background: var(--accent-soft); }
    .cand.on { background: var(--accent-soft); border-color: var(--accent); font-weight: 600; }
    .pos { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .chip { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--bg-elev); color: var(--fg-2); }
    .body { padding: 4px 14px 10px; }
    .sense { margin: 8px 0; }
    .pos-line { font-size: 11px; color: var(--fg-3); margin: 12px 0 2px; letter-spacing: .3px; }
    .sense-no { font-weight: 700; margin-right: 4px; }
    .ex-title { font-size: 11px; color: var(--fg-3); margin: 12px 0 4px; }
    .ex { font-size: 13px; padding: 3px 0 3px 10px; border-left: 2px solid var(--accent-line); margin: 4px 0; color: var(--fg-2); }
    .foot { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center;
      justify-content: space-between; gap: 8px; padding: 8px 12px;
      background: var(--bg); border-top: 1px solid var(--line); }
    .link { font-size: 11px; color: var(--fg-3); text-decoration: none; }
    .star { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: none;
      cursor: pointer; border-radius: 8px; padding: 0; }
    .star:hover { background: var(--bg-elev); }
    .star svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
    .star.on svg { fill: #f5c518; stroke: #f5c518; }
    .star:disabled { opacity: .5; cursor: default; }
    .msg { padding: 16px 14px; font-size: 13px; color: var(--fg-2); }
    .toast { position: fixed; z-index: 3; font-size: 11px; padding: 6px 12px;
      border-radius: 10px; background: var(--warn-bg); color: var(--warn-fg); text-align: center; }
    .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--line);
      border-top-color: var(--accent); border-radius: 50%; animation: r .7s linear infinite; }
    @keyframes r { to { transform: rotate(360deg); } }
  `;
  root.append(style);

  const layer = document.createElement('div');
  layer.className = 'layer';
  layer.style.display = 'none';
  root.append(layer);
  document.documentElement.append(host);

  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;

  function hide() {
    stage = 'idle';
    layer.style.display = 'none';
    layer.innerHTML = '';
  }

  function place(rect, width, { card = false } = {}) {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const boxW = Math.min(width, vw - pad * 2);

    const box = GEOM.cardBox(card ? cardPosition : 'anchor', rect, boxW, vw);
    layer.style.left = `${Math.max(pad, box.left)}px`;
    layer.style.top = '0px'; // 先摆到 0 再量高度，否则量到的是旧位置的高度

    // max-height 已经把卡片夹住，这里量到的是实际可见高度
    const height = layer.getBoundingClientRect().height;
    layer.style.top = `${GEOM.clampTop(box.top, height, vh, pad)}px`;
  }

  function renderPill(rect) {
    stage = 'pill';
    layer.className = 'layer pill';
    layer.innerHTML = `${icon}<span>查词</span>`;
    layer.style.display = 'block';
    place(rect, 76);
    layer.onclick = (e) => {
      e.stopPropagation();
      openCard();
    };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderCard() {
    const e = currentEntry;
    const senses = (e.senses || []).slice(0, 6);
    const examples = (e.examples || []).slice(0, 5);
    const parts = [];
    parts.push(`<div class="head"><div class="word">${escapeHtml(e.word)}</div>`);
    if (currentChain.length > 1) {
      // 变形链：惹かれて → 惹かれる → 惹く（当前层加粗）
      const line = [...new Set([currentWord, ...currentChain])]
        .filter(Boolean)
        .map((w, i, arr) => (i === arr.length - 1 ? `<b>${escapeHtml(w)}</b>` : escapeHtml(w)))
        .join(' → ');
      parts.push(`<div class="chain">${line}</div>`);
    } else if (currentWord && currentWord !== e.word) {
      parts.push(`<div class="hint-line">原选词：${escapeHtml(currentWord)}${currentSource === 'kuromoji' ? ' · 已按上下文还原' : ''}</div>`);
    }
    if (currentCandidates.length > 1) {
      const chips = currentCandidates
        .map((c) => `<button class="cand${c === e.word ? ' on' : ''}" data-word="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
        .join('');
      parts.push(`<div class="cands" role="group" aria-label="原形候选">${chips}</div>`);
    }
    const meta = [];
    if (e.reading) meta.push(`<span>${escapeHtml(e.reading)}</span>`);
    if (e.pitch) meta.push(`<span class="pitch">音调 ${escapeHtml(e.pitch)}${e.pitchNumber != null ? ` · ${e.pitchNumber}型` : ''}</span>`);
    if (e.romaji) meta.push(`<span>${escapeHtml(e.romaji)}</span>`);
    parts.push(`<div class="reading">${meta.join('')}</div>`);
    if (e.pos?.length) parts.push(`<div class="pos">${e.pos.map((p) => `<span class="chip">${escapeHtml(p)}</span>`).join('')}</div>`);
    parts.push('</div>');

    parts.push('<div class="body">');
    if (senses.length) {
      // 一个词条可能有多个词性块（如 都合 = 名・他サ + 副），分组标一下更清楚
      const multiPos = new Set(senses.map((s) => s.pos).filter(Boolean)).size > 1;
      let lastPos = '';
      for (const s of senses) {
        if (multiPos && s.pos && s.pos !== lastPos) {
          parts.push(`<div class="pos-line">${escapeHtml(s.pos)}</div>`);
          lastPos = s.pos;
        }
        parts.push(`<div class="sense"><span class="sense-no">${s.no}.</span>${escapeHtml(s.text)}</div>`);
      }
    } else {
      parts.push(`<div class="msg">该词条只有简释：${escapeHtml(e.gloss || '（无）')}</div>`);
    }
    if (examples.length) {
      parts.push('<div class="ex-title">例句</div>');
      for (const x of examples) parts.push(`<div class="ex">${escapeHtml(x)}</div>`);
    }
    parts.push('</div>');

    parts.push(`<div class="foot">
      <a class="link" href="${escapeHtml(e.url || '#')}" target="_blank" rel="noreferrer">dict.asia ↗</a>
      <button class="star${starred ? ' on' : ''}" title="收藏到今日词汇" aria-pressed="${starred}">
        <svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/></svg>
      </button>
    </div>`);

    layer.className = 'layer card';
    layer.innerHTML = parts.join('');
    layer.style.display = 'block';
    place(anchorRect || { left: 20, top: 20, width: 0, bottom: 40 }, 360, { card: true });
    layer.querySelector('.star').onclick = async (ev) => {
      ev.stopPropagation();
      await onStar(/** @type {HTMLButtonElement} */ (ev.currentTarget));
    };
    bindCands();
  }

  async function onStar(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const res = await chrome.runtime.sendMessage({
      type: 'save',
      payload: {
        entry: currentEntry,
        surface: currentWord,
        lemmaSource: currentSource,
        candidates: currentCandidates,
        context: currentContext,
        pageUrl: location.href,
        pageTitle: document.title,
      },
    });
    btn.disabled = false;
    if (res?.ok) {
      starred = true;
      btn.classList.add('on');
      btn.setAttribute('aria-pressed', 'true');
      flash(res.deduped ? '这个词今天已经记过了（计数 +1）' : `已收藏到 ${res.date}`);
    } else {
      flash(res?.reason || '收藏失败');
    }
  }

  let toastEl = null;

  function flash(text) {
    toastEl?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    // 卡片自己是滚动容器，toast 必须挂在 shadow root 上并用视口坐标，
    // 否则会跟着滚动内容跑到底部外面去。
    const r = layer.getBoundingClientRect();
    t.style.left = `${r.left + 10}px`;
    t.style.width = `${Math.max(140, r.width - 20)}px`;
    t.style.bottom = `${Math.max(8, window.innerHeight - r.bottom + 46)}px`;
    root.append(t);
    toastEl = t;
    setTimeout(() => {
      t.remove();
      if (toastEl === t) toastEl = null;
    }, 2600);
  }

  async function openCard(wordOverride, { exact = false } = {}) {
    const word = wordOverride || currentWord;
    currentRequestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    stage = 'card';
    layer.className = 'layer card';
    layer.innerHTML = '<div class="msg"><span class="spin"></span>　查询中…</div>';
    layer.style.display = 'block';
    place(anchorRect || { left: 20, top: 20, width: 0, bottom: 40 }, 360, { card: true });

    const res = await chrome.runtime.sendMessage({
      type: 'lookup',
      word,
      sentence: currentContext,
      exact,
      requestId: currentRequestId,
    });
    if (stage !== 'card') return;
    if (!res?.ok) {
      const cands = Array.isArray(res?.candidates) ? res.candidates : [];
      const chips = cands.length > 1
        ? `<div class="cands">${cands.map((c) => `<button class="cand" data-word="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>`
        : '';
      layer.innerHTML = `<div class="msg">没查到「${escapeHtml(word)}」。<br>${escapeHtml(res?.reason || '')}${chips}</div>`;
      bindCands();
      return;
    }
    currentEntry = res.entry;
    currentCandidates = Array.isArray(res.candidates) ? res.candidates : [];
    currentChain = Array.isArray(res.chain) ? res.chain : [];
    currentSource = res.lemmaSource || 'none';
    const check = await chrome.runtime.sendMessage({ type: 'check', word: currentEntry.word });
    starred = Boolean(check?.starred);
    renderCard();
  }

  /** 候选胶囊：点一下就用那个原形重查。 */
  function bindCands() {
    layer.querySelectorAll('.cand').forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        // exact：用户明确点了这一层，别再自动深化把他弹回去
        openCard(btn.dataset.word, { exact: true });
      };
    });
  }

  function selectionText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    return sel.toString().trim();
  }

  function sentenceAround() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === 3 ? node.parentElement : /** @type {Element} */ (node);
    const text = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const at = text.indexOf(currentWord);
    if (at < 0) return text.slice(0, 120);
    return text.slice(Math.max(0, at - 60), at + currentWord.length + 60).trim();
  }

  function evaluateSelection() {
    const text = selectionText();
    if (!text || text === lastSelectionText && stage === 'card') return;
    lastSelectionText = text;

    if (!text) {
      if (stage !== 'idle') hide();
      return;
    }
    if (text.length < MIN_SELECTION || text.length > MAX_SELECTION) {
      if (stage === 'pill') hide();
      return;
    }
    if (!KANA.test(text) && !HAN.test(text)) return;

    const sel = window.getSelection();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    if (stage === 'card') return; // 已有结果卡时不要被二次选区打断

    currentWord = text;
    anchorRect = rect;
    currentContext = sentenceAround();
    renderPill(rect);
  }

  document.addEventListener(
    'mouseup',
    () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(evaluateSelection, DEBOUNCE);
    },
    true,
  );

  document.addEventListener('selectionchange', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluateSelection, DEBOUNCE + 60);
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      const path = e.composedPath?.() || [];
      if (path.includes(host)) return;
      if (stage !== 'idle') hide();
    },
    true,
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage !== 'idle') hide();
  }, true);

  window.addEventListener('scroll', () => {
    if (stage === 'idle' || !anchorRect) return;
    const sel = window.getSelection();
    if (stage === 'pill') {
      if (!sel || sel.isCollapsed) return hide();
      const r = sel.getRangeAt(0).getBoundingClientRect();
      anchorRect = r;
      place(r, 76);
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (stage === 'idle' || !anchorRect) return;
    if (stage === 'card') place(anchorRect, 360, { card: true });
    else place(anchorRect, 76);
  }, { passive: true });

  // 分词器就绪后 background 会推一次更精确的结果，替换当前卡片内容
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'jp-vocab:upgrade') return;
    if (msg.requestId !== currentRequestId || stage !== 'card') return;
    const result = msg.result;
    if (!result?.entry) return;
    currentEntry = result.entry;
    currentCandidates = Array.isArray(result.candidates) ? result.candidates : [];
    currentChain = Array.isArray(result.chain) ? result.chain : [];
    currentSource = result.lemmaSource || 'none';
    renderCard();
  });

  // 结果卡位置偏好存在浏览器端（不写共享配置：它是纯 UI 偏好）
  try {
    chrome.storage.sync.get({ cardPosition: 'top-right' })
      .then((saved) => { cardPosition = saved.cardPosition === 'anchor' ? 'anchor' : 'top-right'; })
      .catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.cardPosition) return;
      cardPosition = changes.cardPosition.newValue === 'anchor' ? 'anchor' : 'top-right';
      if (stage === 'card' && anchorRect) place(anchorRect, 360, { card: true });
    });
  } catch {
    /* 存储不可用时保持默认 */
  }

  console.info(`[jp-vocab] content script ${BUILD}`);
})();

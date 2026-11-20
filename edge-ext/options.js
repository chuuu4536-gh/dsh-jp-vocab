/** 设置页：读写共享配置（宿主与 DSH 插件读同一份文件）。 */
const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
}

function renderDayPreview() {
  const hour = Number($('dayStartHour').value) || 0;
  const pad = (n) => String(n).padStart(2, '0');
  const label = hour === 0 ? '自然日（00:00 ~ 23:59）' : `${pad(hour)}:00 ~ 次日 ${pad(hour)}:59`;
  $('dayPreview').textContent = `当前：${label} 归档为同一天；文件以起始日命名。`;
}

async function loadSettings() {
  const { direction = 'auto', cardPosition = 'top-right' } = await chrome.storage.sync.get({
    direction: 'auto',
    cardPosition: 'top-right',
  });
  $('direction').value = direction;
  for (const el of document.querySelectorAll('input[name=cardPosition]')) {
    el.checked = el.value === (cardPosition === 'anchor' ? 'anchor' : 'top-right');
  }
}

function applyConfig(c) {
  $('vocabDir').value = c.vocabDir || '';
  $('summariesDir').value = c.summariesDir || '';
  $('dayStartHour').value = String(Number.isFinite(Number(c.dayStartHour)) ? Number(c.dayStartHour) : 0);
  const mode = c.enrichMode === 'manual' ? 'manual' : 'auto';
  for (const el of document.querySelectorAll('input[name=enrichMode]')) el.checked = el.value === mode;
  $('overwrite').checked = c.overwrite !== false;
  $('groupByPos').checked = c.groupByPos !== false;
  $('includeContext').checked = c.includeContext === true;
  $('templatePath').value = c.templatePath || '';
  renderDayPreview();
}

async function probeHost() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ping' });
    if (res?.ok) {
      applyConfig(res.host?.config || {});
      setStatus(`本地宿主已连接（v${res.host.version}，pid ${res.host.pid}）`, 'ok');
      return true;
    }
    setStatus(`本地宿主未连接：${res?.reason || '未知原因'}。请先运行 native-host\\install.ps1`, 'bad');
    return false;
  } catch (error) {
    setStatus(`本地宿主未连接：${error.message}`, 'bad');
    return false;
  }
}

$('save').addEventListener('click', async () => {
  const modeEl = document.querySelector('input[name=enrichMode]:checked');
  const config = {
    vocabDir: $('vocabDir').value.trim(),
    summariesDir: $('summariesDir').value.trim(),
    dayStartHour: Number($('dayStartHour').value) || 0,
    enrichMode: modeEl ? modeEl.value : 'auto',
    overwrite: $('overwrite').checked,
    groupByPos: $('groupByPos').checked,
    includeContext: $('includeContext').checked,
    templatePath: $('templatePath').value.trim(),
  };
  if (!config.vocabDir) return setStatus('词汇目录不能为空', 'bad');
  const posEl = document.querySelector('input[name=cardPosition]:checked');
  await chrome.storage.sync.set({
    direction: $('direction').value,
    cardPosition: posEl ? posEl.value : 'top-right',
  });
  const res = await chrome.runtime.sendMessage({ type: 'configure', config });
  if (res?.ok) {
    applyConfig(res.config || config);
    setStatus('已保存到共享配置（宿主与汇总插件同时生效）', 'ok');
  } else {
    setStatus(`保存失败：${res?.reason || res?.error || '宿主未连接'}`, 'bad');
  }
});

$('test').addEventListener('click', probeHost);
$('dayStartHour').addEventListener('change', renderDayPreview);

loadSettings().then(probeHost);

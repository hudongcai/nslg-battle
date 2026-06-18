// ============================================================
//  OCR 子系统（可选加载，不影响线上环境）
//  本地 localhost 自动启用，线上自动关闭
//  调用 Cloudflare Worker 代理，不暴露 API Key
// =============================================================

const OCR_CONFIG = {
  // 本地自动启用，线上也启用（依赖云端 Worker 处理 OCR）
  enabled: true,
  model: 'ep-m-20260426183050-krmx7',
  maxTokens: 3000,
  temperature: 0,     // 确定性输出，避免每次结果不一致
  timeout: 120000,    // 视觉模型识别大图可能较久，从60s提升到120s
  batchConcurrency: 1,
  batchInterval: 1500,
};

// 一站式 OCR 上传端点（后端处理识别→解析→存库）
function getOcrUploadEndpoint() {
  if (typeof CLOUD_API_BASE !== 'undefined' && CLOUD_API_BASE) {
    return CLOUD_API_BASE + '/battles/ocr-upload';
  }
  return 'http://localhost:3000/api/battles/ocr-upload';
}

// ========== 状态 ==========
let ocrQueue = [];
let ocrRunning = false;
let ocrPaused = false;
let batchAbortController = null;  // 用于中止正在进行的 OCR 请求（暂停时使用）
let ocrPausedByUser = false;      // 标记是否为用户主动暂停导致的中止
let _labelConfigCache = null;      // 标注配置缓存（按 projectId）
let _labelConfigProjectId = null;  // 缓存对应的 projectId

// 获取标注配置（带缓存）
async function getLabelConfig(projectId) {
  if (!projectId) return null;
  if (_labelConfigCache && _labelConfigProjectId === projectId) return _labelConfigCache;
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const resp = await fetch('/api/label-config/' + projectId, {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    const data = await resp.json();
    if (data.code === 200 && data.data && data.data.categories) {
      _labelConfigCache = data.data.categories;
      _labelConfigProjectId = projectId;
      return _labelConfigCache;
    }
  } catch (e) { /* 无配置时使用自动检测 */ }
  return null;
}

// ========== 初始化 ==========
function initOCR() {
  if (!OCR_CONFIG.enabled) {
    return;
  }
  showOCRSection();
  setupOCRListeners();
  updateOCRStatus('ok', 'OCR 就绪');
}

function showOCRSection() {
  // 显示 header 中的 OCR 状态指示器
  const status = document.getElementById('ocrStatus');
  if (status) status.style.display = 'flex';
}

function setupOCRListeners() {
  const uploadZone = document.getElementById('uploadZone');
  if (uploadZone) {
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('dragover');
      handleBatchUpload(e.dataTransfer.files);
    });
    // 点击上传（HTML 中 uploadZone 的 onclick 会触发 batchInput.click()，这里无需重复绑定）
  }
  // batchInput 的 onchange 在 HTML 中直接绑定 handleBatchUpload(this.files)
}

// ========== 批量上传 ==========

// 点击上传区前先检查积分（从云端获取最新值）
async function checkCreditsBeforeUpload() {
  if (!currentUser) return;
  try {
    const pts = await getUserPoints(currentUser.phone);
    if (pts <= 0) {
      showPointsInsufficientModal(pts, 1);
      return;
    }
    // 积分充足，打开文件选择对话框
    const input = document.getElementById('batchInput');
    if (input) input.click();
  } catch (e) {
    // 网络问题获取不到积分，放行让后续步骤再次检查
    const input = document.getElementById('batchInput');
    if (input) input.click();
  }
}

async function handleBatchUpload(files) {
  if (!files || files.length === 0) return;

  // 查询已成功识别的文件名，跳过这些文件（失败的允许重新处理）
  let successNames = new Set();
  try {
    updateOCRStatus('work', '检查已处理文件...');
    const data = await cloudRequest('/gallery/imagenames?successOnly=true');
    if (data && data.code === 200 && Array.isArray(data.data)) {
      successNames = new Set(data.data);
    }
  } catch (e) {
    console.warn('[BatchUpload] 获取已成功列表失败，不跳过任何文件:', e.message);
  }
  updateOCRStatus('ok', 'OCR 就绪');

  // 过滤掉已成功识别的文件
  const filesToProcess = Array.from(files).filter(f => !successNames.has(f.name));
  const skippedCount = files.length - filesToProcess.length;

  if (filesToProcess.length === 0) {
    updateOCRStatus('ok', `全部 ${files.length} 张已成功识别，无需重复处理`);
    setTimeout(() => updateOCRStatus('ok', 'OCR 就绪'), 4000);
    return;
  }

  // 从云端获取最新积分（管理员可能已调整）
  let userPoints = (currentUser && currentUser.points) || 0;
  try {
    if (currentUser && typeof getUserPoints === 'function') {
      userPoints = await getUserPoints(currentUser.phone);
    }
  } catch (e) { /* 网络问题，回退到本地缓存值 */ }

  // 积分校验基于实际待处理数量（已跳过的不扣积分）
  if (filesToProcess.length > userPoints) {
    showPointsInsufficientModal(userPoints, filesToProcess.length);
    return;
  }

  const existingNames = new Set(ocrQueue.filter(i => i.status === 'pending' || i.status === 'processing').map(i => i.name));
  let addedCount = 0;
  for (const file of filesToProcess) {
    if (existingNames.has(file.name)) continue;
    existingNames.add(file.name);
    ocrQueue.push({ file, name: file.name, status: 'pending', error: null });
    addedCount++;
  }

  if (skippedCount > 0) {
    updateOCRStatus('ok', `已跳过 ${skippedCount} 张（已成功识别），入队 ${addedCount} 张`);
    setTimeout(() => updateOCRStatus('ok', 'OCR 就绪'), 4000);
  }

  renderOCRQueue();
  const queueArea = document.getElementById('queueArea');
  if (queueArea) queueArea.style.display = 'block';
}

function renderOCRQueue() {
  const queueCount = document.getElementById('queueCount');
  const queueList = document.getElementById('queueList');
  if (queueCount) queueCount.textContent = ocrQueue.length;

  if (queueList) {
    queueList.innerHTML = ocrQueue.map((item, idx) => {
      const statusClass = item.status === 'pending' ? 'qi-pending'
        : item.status === 'processing' ? 'qi-processing'
        : item.status === 'done' ? 'qi-done' : 'qi-error';
      const statusIcon = item.status === 'pending' ? '💤'
        : item.status === 'processing' ? '⚙️'
        : item.status === 'done' ? '✅' : '❌';
      const statusText = item.status === 'pending' ? '等待中'
        : item.status === 'processing' ? '处理中...'
        : item.status === 'done' ? '完成'
        : (item.error || '失败');
      // 只有 pending / error 状态允许删除，按钮放在状态右侧
      const canDelete = item.status === 'pending' || item.status === 'error';
      const delBtn = canDelete
        ? `<span class="qi-del" title="删除" onclick="removeQueueItem(${idx})">✕</span>`
        : '';
      return `<div class="queue-item">
        <span class="qi-icon">${statusIcon}</span>
        <span class="qi-name">${escHtml(item.name)}</span>
        <span class="${statusClass}">${statusText}</span>
        ${delBtn}
      </div>`;
    }).join('');
  }
}

// 删除单个队列项
function removeQueueItem(idx) {
  const item = ocrQueue[idx];
  if (!item) return;
  if (item.status === 'processing') {
    alert('正在处理中的文件无法删除');
    return;
  }
  ocrQueue.splice(idx, 1);
  renderOCRQueue();
  const queueCount = document.getElementById('queueCount');
  if (queueCount) queueCount.textContent = ocrQueue.length;
  // 如果队列空了且没在跑，隐藏区域
  if (ocrQueue.length === 0 && !ocrRunning) {
    const queueArea = document.getElementById('queueArea');
    if (queueArea) queueArea.style.display = 'none';
  }
}

function clearQueue() {
  ocrQueue = ocrQueue.filter(q => q.status === 'processing');
  const queueArea = document.getElementById('queueArea');
  if (!ocrRunning && queueArea) queueArea.style.display = 'none';
  renderOCRQueue();
}

// ========== 文件夹自动监听 ==========
let folderWatchHandle = null;
let folderWatchTimer = null;
let folderWatchActive = false;
let folderProcessedSet = new Set();
let folderNewCount = 0;

function getFolderStorageKey(name) {
  return `folder-watch-processed::${name}`;
}

function loadFolderProcessed(name) {
  try {
    const raw = localStorage.getItem(getFolderStorageKey(name));
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
}

function saveFolderProcessed(name, set) {
  try {
    localStorage.setItem(getFolderStorageKey(name), JSON.stringify([...set]));
  } catch (e) {}
}

async function selectWatchFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    folderWatchHandle = handle;
    const wasActive = folderWatchActive;
    if (wasActive) stopFolderWatch();
    document.getElementById('folderWatchName').textContent = handle.name;
    document.getElementById('btnFolderWatch').disabled = false;
    folderProcessedSet = await loadFolderProcessedSet(handle.name);
    folderNewCount = 0;
    updateFolderWatchStats();
  } catch (e) {
    if (e.name !== 'AbortError') alert('选择文件夹失败：' + e.message);
  }
}

async function loadFolderProcessedSet(folderName) {
  // 优先从服务端拉取已上传文件名（跨session持久化，不依赖localStorage）
  try {
    const data = await cloudRequest('/gallery/imagenames');
    if (data && data.code === 200 && Array.isArray(data.data)) {
      const serverSet = new Set(data.data);
      // 合并localStorage作为补充（兼容本地未同步到服务端的情况）
      const localSet = loadFolderProcessed(folderName);
      localSet.forEach(n => serverSet.add(n));
      return serverSet;
    }
  } catch (e) {
    console.warn('[FolderWatch] 服务端查询已处理文件失败，回退localStorage:', e.message);
  }
  return loadFolderProcessed(folderName);
}

async function toggleFolderWatch() {
  if (folderWatchActive) {
    stopFolderWatch();
  } else {
    await startFolderWatch();
  }
}

async function startFolderWatch() {
  if (!folderWatchHandle) return;
  folderWatchActive = true;
  folderNewCount = 0;
  const btn = document.getElementById('btnFolderWatch');
  const statusEl = document.getElementById('folderWatchStatus');
  if (btn) { btn.textContent = '⏹ 停止'; btn.className = 'btn btn-sm btn-danger'; }
  if (statusEl) { statusEl.textContent = '监听中...'; statusEl.style.cssText += ';background:var(--accent);color:#fff;'; }
  document.getElementById('folderWatchStats').style.display = 'block';
  await scanWatchFolder();
  folderWatchTimer = setInterval(() => { if (folderWatchActive) scanWatchFolder(); }, 5000);
}

function stopFolderWatch() {
  folderWatchActive = false;
  if (folderWatchTimer) { clearInterval(folderWatchTimer); folderWatchTimer = null; }
  const btn = document.getElementById('btnFolderWatch');
  const statusEl = document.getElementById('folderWatchStatus');
  if (btn) { btn.textContent = '▶ 启动'; btn.className = 'btn btn-sm btn-primary'; }
  if (statusEl) { statusEl.textContent = '已停止'; statusEl.style.cssText += ';background:var(--bg3);color:var(--text3);'; }
}

async function scanWatchFolder() {
  if (!folderWatchHandle) return;
  try {
    const newFiles = [];
    for await (const [name, handle] of folderWatchHandle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!/\.(png|jpg|jpeg)$/i.test(name)) continue;
      if (folderProcessedSet.has(name)) continue;
      const file = await handle.getFile();
      newFiles.push({ name, file });
    }
    if (newFiles.length === 0) return;
    for (const { name, file } of newFiles) {
      folderProcessedSet.add(name);
      ocrQueue.push({ file, name, status: 'pending', error: null });
      folderNewCount++;
    }
    saveFolderProcessed(folderWatchHandle.name, folderProcessedSet);
    updateFolderWatchStats();
    document.getElementById('queueArea').style.display = 'block';
    renderOCRQueue();
    if (!ocrRunning && !ocrPausedByUser) startBatchProcess();
  } catch (e) {
    console.error('文件夹扫描出错:', e.message);
  }
}

function updateFolderWatchStats() {
  const p = document.getElementById('folderProcessedCount');
  const n = document.getElementById('folderNewCount');
  if (p) p.textContent = folderProcessedSet.size;
  if (n) n.textContent = folderNewCount;
}

// ========== 文件读取 ==========
// 读取文件并压缩为 base64（最大宽度 1920px，质量 0.85），避免大图导致 OCR 超时
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    // 小于 800KB 的图片直接读取，不压缩
    if (file.size < 800 * 1024) {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
      return;
    }
    // 大图先压缩再转 base64
    const img = new Image();
    img.onload = () => {
      const MAX_W = 1920, MAX_H = 1920;
      let w = img.width, h = img.height;
      if (w > MAX_W || h > MAX_H) {
        if (w / h > MAX_W / MAX_H) { h = Math.round(h * MAX_W / w); w = MAX_W; }
        else { w = Math.round(w * MAX_H / h); h = MAX_H; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const quality = file.size > 3 * 1024 * 1024 ? 0.75 : 0.85;
      resolve(canvas.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      // 压缩失败时 fallback 到原始读取
      console.warn('[OCR] 图片压缩失败，使用原始大小');
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    };
    img.src = URL.createObjectURL(file);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 批量处理 ==========
async function startBatchProcess() {
  if (ocrRunning) return;

  // 检查积分：待处理张数不能超过剩余积分，实际按成功张数扣（失败不扣）
  const fileCount = ocrQueue.filter(i => i.status === 'pending').length;
  if (fileCount > 0 && currentUser) {
    const pts = await getUserPoints(currentUser.phone);
    if (pts < fileCount) {
      showPointsInsufficientModal(pts, fileCount);
      return;
    }
    if (typeof updateUserNavPoints === 'function') updateUserNavPoints();
  }

  ocrRunning = true;
  ocrPaused = false;
  ocrPausedByUser = false;
  batchAbortController = new AbortController();

  const btnStart = document.getElementById('btnStartBatch');
  const btnPause = document.getElementById('btnPauseBatch');
  if (btnStart) btnStart.disabled = true;
  if (btnPause) { btnPause.disabled = false; btnPause.textContent = '⏸ 暂停'; }

  let processing = 0;
  let idx = 0;

  async function processNext() {
    while (idx < ocrQueue.length) {
      if (!ocrRunning) break;
      while (ocrPaused && ocrRunning) await sleep(500);
      if (!ocrRunning) break;
      while (processing >= OCR_CONFIG.batchConcurrency && idx < ocrQueue.length) await sleep(500);
      if (!ocrRunning) break;

      const item = ocrQueue[idx];
      if (item.status !== 'pending') { idx++; continue; }

      item.status = 'processing';
      processing++;
      renderOCRQueue();

      let base64 = null;
      try {
        base64 = await readFileAsBase64(item.file);
        const abortSig = batchAbortController ? batchAbortController.signal : null;
        const token = typeof getToken === 'function' ? getToken() : '';

        updateOCRStatus('work', 'OCR 识别中...');
        // 获取标注配置（有缓存，首次加载后复用）
        const labelCfg = await getLabelConfig(window.currentProjectId);
        const reqBody = {
          image: base64,
          projectId: window.currentProjectId || null,
          imageName: item.name,
        };
        if (labelCfg) reqBody.labelConfig = labelCfg;
        const resp = await fetch(getOcrUploadEndpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
          },
          body: JSON.stringify(reqBody),
          signal: abortSig,
        });
        updateOCRStatus('ok', 'OCR 就绪');

        // 处理 401 强制退出
        if (resp.status === 401) {
          let errMsg = '';
          try { errMsg = (await resp.json()).message || ''; } catch(e) {}
          const isFatal = errMsg.includes('账号不存在') || errMsg.includes('已被禁用') || errMsg.includes('登录状态已过期');
          if (isFatal) {
            if (typeof setToken === 'function') setToken(null);
            if (typeof clearSession === 'function') clearSession();
            if (typeof currentUser !== 'undefined') currentUser = null;
            setTimeout(() => {
              alert((errMsg || '账号异常') + '，即将退出登录');
              if (typeof showLogin === 'function') showLogin(); else location.reload();
            }, 0);
          }
          throw new Error('HTTP 401: ' + errMsg);
        }

        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        const result = await resp.json();

        // 积分不足：停止批处理
        if (result.code === 402) {
          processing--;
          idx++;
          renderOCRQueue();
          updateOCRProgress();
          ocrRunning = false;
          if (btnStart) btnStart.disabled = false;
          if (btnPause) btnPause.disabled = true;
          showPointsInsufficientModal(0, 1);
          return;
        }

        // OCR 服务不可用 → 立即停止整个批处理
        if (result.code === 503) {
          ocrRunning = false;
          if (btnStart) btnStart.disabled = false;
          if (btnPause) { btnPause.disabled = true; btnPause.textContent = '⏸ 暂停'; }
          updateOCRStatus('error', 'OCR 服务不可用');
          item.status = 'pending';  // 回退，等 OCR 恢复后重试
          item.error = null;
          processing--;
          renderOCRQueue();
          updateOCRProgress();
          alert('OCR 服务不可用，批处理已暂停。\n请确认 OCR 服务运行正常后点击"开始处理"继续。');
          return;
        }

        if (result.code !== 200) throw new Error(result.message || 'OCR 失败');

        const record = result.data;
        // 缓存到本地 IndexedDB（服务端已存入 MySQL，不重复同步云端）
        if (typeof dbAddLocal === 'function') {
          const localId = await dbAddLocal(record);
          if (typeof addSysLog === 'function') {
            addSysLog('action', '上传战报: ' + (record.leftPlayer || record.attackerName || item.name) + (window.currentProjectId ? ' [项目ID:' + window.currentProjectId + ']' : ''));
          }
          if (window.currentProjectId && typeof addBattleToProject === 'function' && localId) {
            await addBattleToProject(window.currentProjectId, localId);
          }
        }
        item.status = 'done';
        // 积分已由服务端扣除，只需刷新 UI 显示
        if (typeof updateUserNavPoints === 'function') updateUserNavPoints();
      } catch (e) {
        // 用户主动暂停导致的中止
        if (e.name === 'AbortError' && ocrPausedByUser) {
          item.status = 'pending';
          item.error = null;
          processing--;
          renderOCRQueue();
          updateOCRProgress();
          ocrRunning = false;
          if (btnStart) btnStart.disabled = false;
          if (btnPause) { btnPause.disabled = false; }
          updateOCRStatus('ok', '已暂停，点击"继续"恢复');
          return;
        }
        // OCR 服务不可达 → 立即停止
        const msg = e.message || '';
        if (msg.includes('503') || msg.includes('服务不可用') || msg.includes('OCR') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          ocrRunning = false;
          if (btnStart) btnStart.disabled = false;
          if (btnPause) { btnPause.disabled = true; btnPause.textContent = '⏸ 暂停'; }
          updateOCRStatus('error', 'OCR 服务不可用');
          item.status = 'pending';
          item.error = null;
          processing--;
          renderOCRQueue();
          updateOCRProgress();
          alert('OCR 服务不可用，批处理已暂停。\n请确认 OCR 服务运行正常后点击"开始处理"继续。');
          return;
        }
        // 识别失败：仅保存本地错误记录（不推送到 MySQL）
        try {
          if (!base64) base64 = await readFileAsBase64(item.file);
          if (typeof dbAddLocal === 'function') {
            const errRec = {
              imageBase64: base64,
              imageName: item.name,
              imageTime: new Date().toLocaleString('zh-CN'),
              _parseError: true, _errorMsg: e.message,
            };
            const localId = await dbAddLocal(errRec);
            if (window.currentProjectId && typeof addBattleToProject === 'function' && localId) {
              await addBattleToProject(window.currentProjectId, localId);
            }
          }
        } catch (e2) { console.error('保存失败图片出错:', e2); }
        item.status = 'error';
        item.error = e.message;
      }

      processing--;
      idx++;
      renderOCRQueue();
      updateOCRProgress();

      if (typeof loadAllRecords === 'function') await loadAllRecords();
      if (typeof renderDataTable === 'function') renderDataTable();
      if (typeof renderGallery === 'function') renderGallery();

      if (idx < ocrQueue.length) await sleep(OCR_CONFIG.batchInterval);
    }

    ocrRunning = false;
    if (btnStart) btnStart.disabled = false;
    if (btnPause) btnPause.disabled = true;
    if (typeof renderDataTable === 'function') renderDataTable();
    if (typeof renderGallery === 'function') renderGallery();
    updateOCRProgress();
    updateOCRStatus('ok', 'OCR 就绪');
  }

  processNext();
}

function toggleBatchPause() {
  const btn = document.getElementById('btnPauseBatch');
  if (!ocrPaused) {
    // ——暂停：立即中止正在进行的 OCR 请求——
    ocrPaused = true;
    ocrPausedByUser = true;
    if (batchAbortController) batchAbortController.abort();
    if (btn) btn.textContent = '▶ 继续';
  } else {
    // ——继续：重新启动批处理（已处理完的项保持 done，从第一个 pending 继续）——
    ocrPaused = false;
    ocrPausedByUser = false;
    if (btn) btn.textContent = '⏸ 暂停';
    if (!ocrRunning) {
      startBatchProcess();
    }
  }
}

function updateOCRProgress() {
  const done = ocrQueue.filter(q => q.status === 'done').length;
  const total = ocrQueue.length;
  const pct = total > 0 ? (done / total * 100) : 0;
  const bar = document.getElementById('batchProgress');
  if (bar) {
    bar.style.width = pct + '%';
    const txt = bar.querySelector('.progress-text');
    if (txt) txt.textContent = `处理中 (${done}/${total})`;
  }
}

function updateOCRStatus(status, text) {
  const dot = document.getElementById('ocrDot');
  const txt = document.getElementById('ocrText');
  if (dot) dot.className = 'ocr-dot ' + status;
  if (txt) txt.textContent = text;
}

// ========== DOM Ready ==========
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOCR);
} else {
  initOCR();
}

// ========== 积分不足弹窗 ==========
function showPointsInsufficientModal(currentPoints, neededPoints) {
  closePointsInsufficientModal();
  const shortfall = Math.max(0, neededPoints - currentPoints);
  const overlay = document.createElement('div');
  overlay.id = 'pointsInsufficientOverlay';
  overlay.className = 'points-insufficient-overlay';
  overlay.innerHTML = `
    <div class="points-insufficient-panel">
      <div class="pi-icon">💰</div>
      <div class="pi-title">积分余额不足</div>
      <div class="pi-info">
        <div class="pi-row">
          <span class="pi-label">当前积分：</span>
          <span class="pi-value">${currentPoints} 分</span>
        </div>
        <div class="pi-row">
          <span class="pi-label">本次需要：</span>
          <span class="pi-value">${neededPoints} 分</span>
        </div>
        <div class="pi-row">
          <span class="pi-label">还差：</span>
          <span class="pi-value" style="color:var(--red);">${shortfall} 分</span>
        </div>
        <div class="pi-warn">⚠️ 积分不足，请充值后再试</div>
      </div>
      <div class="pi-btns">
        <button class="btn btn-secondary" onclick="closePointsInsufficientModal()">返回</button>
        <button class="btn btn-primary" onclick="closePointsInsufficientModal(); typeof showPointsMall==='function'&&showPointsMall();">确认充值</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closePointsInsufficientModal();
  });
  document.body.appendChild(overlay);
}

function closePointsInsufficientModal() {
  const overlay = document.getElementById('pointsInsufficientOverlay');
  if (overlay) overlay.remove();
}

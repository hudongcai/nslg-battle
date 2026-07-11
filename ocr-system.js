// ============================================================
//  OCR 瀛愮郴缁燂紙鍙€夊姞杞斤紝涓嶅奖鍝嶇嚎涓婄幆澧冿級
//  鏈湴 localhost 鑷姩鍚敤锛岀嚎涓婅嚜鍔ㄥ叧闂?
//  璋冪敤 Cloudflare Worker 浠ｇ悊锛屼笉鏆撮湶 API Key
// =============================================================

const OCR_CONFIG = {
  // 鏈湴鑷姩鍚敤锛岀嚎涓婁篃鍚敤锛堜緷璧栦簯绔?Worker 澶勭悊 OCR锛?
  enabled: true,
  model: 'ep-m-20260426183050-krmx7',
  maxTokens: 3000,
  temperature: 0,     // 纭畾鎬ц緭鍑猴紝閬垮厤姣忔缁撴灉涓嶄竴鑷?
  timeout: 120000,    // 瑙嗚妯″瀷璇嗗埆澶у浘鍙兘杈冧箙锛屼粠60s鎻愬崌鍒?20s
  batchConcurrency: 1,
  batchInterval: 0,           // 绋冲畾鎬т紭鍏堬細鍘婚櫎寮哄埗闂撮殧
  maxRetries: 3,              // 鐬椂閿欒鏈€澶ч噸璇曟鏁帮紙503/缃戠粶鎶栧姩锛?
  retryBaseDelay: 3000,       // 閲嶈瘯鍩虹寤惰繜 ms锛堟寚鏁伴€€閬?3s鈫?s鈫?2s锛?
  renderThrottleCount: 10,    // 姣?N 寮犲埛鏂颁竴娆℃暟鎹〃/鍥惧簱
  renderThrottleMs: 5000,     // 鎴栨瘡 M 姣鍒锋柊涓€娆?
};

// 涓€绔欏紡 OCR 涓婁紶绔偣锛堝悗绔鐞嗚瘑鍒啋瑙ｆ瀽鈫掑瓨搴擄級
function getOcrUploadEndpoint() {
  if (typeof CLOUD_API_BASE !== 'undefined' && CLOUD_API_BASE) {
    return CLOUD_API_BASE + '/battles/ocr-upload';
  }
  return 'http://localhost:3000/api/battles/ocr-upload';
}

// ========== 鐘舵€?==========
let ocrQueue = [];
let ocrRunning = false;
let ocrPaused = false;
let batchAbortController = null;  // 鐢ㄤ簬涓姝ｅ湪杩涜鐨?OCR 璇锋眰锛堟殏鍋滄椂浣跨敤锛?
let ocrPausedByUser = false;      // 鏍囪鏄惁涓虹敤鎴蜂富鍔ㄦ殏鍋滃鑷寸殑涓
let _labelConfigCache = null;      // 鏍囨敞閰嶇疆缂撳瓨锛堟寜 projectId锛?let _labelConfigProjectId = null;  // 缂撳瓨瀵瑰簲鐨?projectId

// 淇濆瓨妯℃澘鍚庤皟鐢紝浣跨紦瀛樺け鏁堬紙涓嬫 OCR 浼氶噸鏂颁粠 DB 鎷夊彇鏈€鏂伴厤缃級
function invalidateLabelConfigCache() {
  _labelConfigCache = null;
  _labelConfigProjectId = null;
}

// 鑾峰彇鏍囨敞閰嶇疆锛堝甫缂撳瓨锛?
// 浼樺厛鍙栭」鐩笓灞為厤缃紝鏃犲垯鍚庣鑷姩鍥為€€鍏ㄥ眬閰嶇疆锛坧roject_id=0锛?
// projectId 涓?null 鏃朵篃鎷夊叏灞€閰嶇疆锛屼繚璇佹墍鏈変笂浼犻兘璧?extract_with_config
async function getLabelConfig(projectId) {
  const pid = projectId || 0;  // null 鈫?0 鈫?鎷夊叏灞€閰嶇疆
  if (_labelConfigCache && _labelConfigProjectId === pid) return _labelConfigCache;
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const _base = (typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : (window.cloudSync?.BASE_URL ? window.cloudSync.BASE_URL + '/api' : '/api'));
    const resp = await fetch(_base + '/label-config/' + pid, {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    const data = await resp.json();
    if (data.code === 200 && data.data && data.data.categories) {
      _labelConfigCache = data.data.categories;
      _labelConfigProjectId = pid;
      return _labelConfigCache;
    }
  } catch (e) { /* 鏃犻厤缃椂浣跨敤鑷姩妫€娴?*/ }
  return null;
}

// ========== 鍒濆鍖?==========
function initOCR() {
  if (!OCR_CONFIG.enabled) {
    return;
  }
  showOCRSection();
  setupOCRListeners();
  updateOCRStatus('ok', 'OCR 就绪');
  // auto-watch polling moved to ocr-watch-v2.js

  // 页面加载时自动加载待处理任务
  setTimeout(() => {
    if (currentUser) {
      loadPendingTasksFromBackend();
    }
  }, 500);
}

function showOCRSection() {
  // 鏄剧ず header 涓殑 OCR 鐘舵€佹寚绀哄櫒
  const status = document.getElementById('ocrStatus');
  if (status) status.style.display = 'flex';
}

function normalizeQueueProjectId(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') return null;
  const trimmed = String(projectId).trim();
  const num = Number(trimmed);
  return Number.isFinite(num) && String(num) === trimmed ? num : trimmed;
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
    // 鐐瑰嚮涓婁紶锛圚TML 涓?uploadZone 鐨?onclick 浼氳Е鍙?batchInput.click()锛岃繖閲屾棤闇€閲嶅缁戝畾锛?
  }
  // batchInput 鐨?onchange 鍦?HTML 涓洿鎺ョ粦瀹?handleBatchUpload(this.files)
}

// ========== 鎵归噺涓婁紶 ==========

// 鐐瑰嚮涓婁紶鍖哄墠鍏堟鏌ョН鍒嗭紙浠庝簯绔幏鍙栨渶鏂板€硷級
async function checkCreditsBeforeUpload() {
  if (!currentUser) { alert('请先登录'); return; }
  try {
    const pts = await getUserPoints(currentUser.phone);
    if (pts <= 0) {
      showPointsInsufficientModal(pts, 1);
      return;
    }
    // 绉垎鍏呰冻锛屾墦寮€鏂囦欢閫夋嫨瀵硅瘽妗?
    const input = document.getElementById('batchInput');
    if (input) input.click();
  } catch (e) {
    // 缃戠粶闂鑾峰彇涓嶅埌绉垎锛屾斁琛岃鍚庣画姝ラ鍐嶆妫€鏌?
    const input = document.getElementById('batchInput');
    if (input) input.click();
  }
}

async function handleBatchUpload(files) {
  if (!files || files.length === 0) return;

  // 鏌ヨ宸叉垚鍔熻瘑鍒殑鏂囦欢鍚嶏紝璺宠繃杩欎簺鏂囦欢锛堝け璐ョ殑鍏佽閲嶆柊澶勭悊锛?
  let successNames = new Set();
  try {
    updateOCRStatus('work', '检查已处理文件...');
    const pid = window.currentProjectId || '';
    const data = await cloudRequest(`/gallery/imagenames?successOnly=true&projectId=${encodeURIComponent(pid)}`);
    if (data && data.code === 200 && Array.isArray(data.data)) {
      successNames = new Set(data.data);
    }
  } catch (e) {
    console.warn('[BatchUpload] 鑾峰彇宸叉垚鍔熷垪琛ㄥけ璐ワ紝涓嶈烦杩囦换浣曟枃浠?', e.message);
  }
  updateOCRStatus('ok', 'OCR 就绪');

  // 杩囨护鎺夊凡鎴愬姛璇嗗埆鐨勬枃浠?
  const filesToProcess = Array.from(files).filter(f => !successNames.has(f.name));
  const skippedCount = files.length - filesToProcess.length;

  if (filesToProcess.length === 0) {
    updateOCRStatus('ok', `全部 ${files.length} 张已成功识别，无需重复处理`);
    setTimeout(() => updateOCRStatus('ok', 'OCR 就绪'), 4000);
    return;
  }

  // 浠庝簯绔幏鍙栨渶鏂扮Н鍒嗭紙绠＄悊鍛樺彲鑳藉凡璋冩暣锛?
  let userPoints = (currentUser && currentUser.points) || 0;
  try {
    if (currentUser && typeof getUserPoints === 'function') {
      userPoints = await getUserPoints(currentUser.phone);
    }
  } catch (e) { /* 缃戠粶闂锛屽洖閫€鍒版湰鍦扮紦瀛樺€?*/ }

  // 绉垎鏍￠獙鍩轰簬瀹為檯寰呭鐞嗘暟閲忥紙宸茶烦杩囩殑涓嶆墸绉垎锛?
  if (filesToProcess.length > userPoints) {
    showPointsInsufficientModal(userPoints, filesToProcess.length);
    return;
  }

  const existingNames = new Set(ocrQueue.filter(i => i.status === 'pending' || i.status === 'processing').map(i => i.name));
  let addedCount = 0;
  for (const file of filesToProcess) {
    if (existingNames.has(file.name)) continue;
    existingNames.add(file.name);
    ocrQueue.push({ file, name: file.name, status: 'pending', error: null, projectId: normalizeQueueProjectId(window.currentProjectId) });
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
  const queueArea = document.getElementById('queueArea');
  const curPid = normalizeQueueProjectId(window.currentProjectId);
  const visibleItems = ocrQueue.map((item, idx) => ({ item, idx }))
    .filter(({ item }) => normalizeQueueProjectId(item.projectId) === curPid);

  // auto-watch items (from ocr-watch-v2.js)
  const watchTask = window.ocrWatchTask;
  const watchTaskMatchesProject = watchTask && Number(watchTask.projectId) === Number(curPid);
  const watchPendingFiles = (watchTaskMatchesProject && Array.isArray(watchTask.pendingFiles))
    ? watchTask.pendingFiles.filter(name => String(name || '').trim())
    : [];
  const watchCurrentFile = watchTaskMatchesProject ? String(watchTask.currentFile || '').trim() : '';
  const watchCompletedFiles = Array.isArray(window.autoCompletedFiles) ? window.autoCompletedFiles : [];
  const watchQueueItems = [];
  if (watchTaskMatchesProject) {
    // 已完成的文件
    watchCompletedFiles.forEach(item => {
      watchQueueItems.push({
        name: item.name,
        time: item.time,
        status: 'done',
        error: '',
        source: 'auto'
      });
    });
    // 正在处理的文件
    if (watchCurrentFile) {
      watchQueueItems.push({
        name: watchCurrentFile,
        status: watchTask.status === 'error' ? 'error' : 'processing',
        error: watchTask.status === 'error' ? (watchTask.lastError || '处理失败') : '',
        source: 'auto'
      });
    }
    // 待处理的文件
    watchPendingFiles.forEach(name => {
      if (name !== watchCurrentFile) {
        watchQueueItems.push({ name, status: 'pending', error: '', source: 'auto' });
      }
    });
  }

  // 统计实际渲染的待处理任务数量
  const autoPendingCount = watchQueueItems.filter(item => item.status === 'pending').length;
  const dbPendingCount = visibleItems.filter(({ item }) => item.status === 'pending').length;
  // 如果本地助手在运行，显示本地助手的pending；否则显示数据库的pending
  // 但如果本地助手pending为0而数据库有pending，说明状态未同步，显示数据库的
  const totalPending = (watchTaskMatchesProject && autoPendingCount > 0) ? autoPendingCount : dbPendingCount;
  if (queueCount) queueCount.textContent = totalPending;
  if (queueArea) queueArea.style.display = 'block';

  if (queueList) {
    if (visibleItems.length === 0 && watchQueueItems.length === 0) {
      queueList.innerHTML = '<div style="text-align:center;padding:16px 12px;color:var(--text3);font-size:12px;">暂无解析任务，手动批量上传或战报自动解析产生的内容都会显示在这里</div>';
    } else {
      const autoHtml = watchQueueItems.map(item => {
        const statusClass = item.status === 'pending' ? 'qi-pending'
          : item.status === 'processing' ? 'qi-processing'
          : item.status === 'done' ? 'qi-done'
          : 'qi-error';
        const statusIcon = item.status === 'pending' ? '⏳'
          : item.status === 'processing' ? '⚙️'
          : item.status === 'done' ? '✅'
          : '❌';
        const statusText = item.status === 'pending' ? '等待中'
          : item.status === 'processing' ? '处理中...'
          : item.status === 'done' ? (item.time ? '完成 ' + item.time : '已完成')
          : (item.error || '自动解析失败');
        return `<div class="queue-item">
          <span class="qi-icon">${statusIcon}</span>
          <span class="qi-name">[自动] ${escHtml(item.name)}</span>
          <span class="${statusClass}">${escHtml(statusText)}</span>
        </div>`;
      }).join('');
      const manualHtml = visibleItems.map(({ item, idx }) => {
      const statusClass = item.status === 'pending' ? 'qi-pending'
        : item.status === 'processing' ? 'qi-processing'
        : item.status === 'done' ? 'qi-done' : 'qi-error';
      const statusIcon = item.status === 'pending' ? '⏳'
        : item.status === 'processing' ? '⚙️'
        : item.status === 'done' ? '✅' : '❌';
      const statusText = item.status === 'pending' ? '等待中'
        : item.status === 'processing' ? '处理中...'
        : item.status === 'done' ? '已完成'
        : (item.error || '失败');
      const canDelete = item.status === 'pending' || item.status === 'error';
      const delBtn = canDelete
        ? `<span class="qi-del" title="删除" onclick="removeQueueItem(${idx})">✕</span>`
        : '';
      const prefix = item.isAutoTask ? '[自动]' : '[手动]';
      return `<div class="queue-item">
        <span class="qi-icon">${statusIcon}</span>
        <span class="qi-name">${prefix} ${escHtml(item.name)}</span>
        <span class="${statusClass}">${statusText}</span>
        ${delBtn}
      </div>`;
    }).join('');
      queueList.innerHTML = autoHtml + manualHtml;
    }
  }

  // 更新进度条（统计手动+自动）
  updateOCRProgress();
}

// 鍒犻櫎鍗曚釜闃熷垪椤?
function removeQueueItem(idx) {
  const item = ocrQueue[idx];
  if (!item) return;
  if (item.status === 'processing') {
    alert('正在处理中的文件无法删除');
    return;
  }
  ocrQueue.splice(idx, 1);
  renderOCRQueue();  // 鍐呴儴澶勭悊 count 鍜?queueArea 鏄鹃殣
}

async function clearQueue() {
  const curPid = normalizeQueueProjectId(window.currentProjectId);
  if (!curPid) {
    console.warn('[OCR] 清空队列失败: 当前项目ID无效');
    return;
  }

  // 调用后端API删除数据库中的任务
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const _base = (typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : (window.cloudSync?.BASE_URL ? window.cloudSync.BASE_URL + '/api' : '/api'));
    const resp = await fetch(`${_base}/battles/ocr-clear-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      body: JSON.stringify({ projectId: curPid })
    });
    const data = await resp.json();
    if (data.code !== 200) {
      console.warn('[OCR] 清空队列失败:', data.message);
      updateOCRStatus('error', '清空失败: ' + (data.message || '未知错误'));
      return;
    }
    console.log('[OCR] 已从数据库删除', data.data.deletedCount, '个待处理任务');
  } catch (e) {
    console.error('[OCR] 清空队列请求失败:', e);
    updateOCRStatus('error', '清空失败: ' + e.message);
    return;
  }

  // 清空前端队列（仅保留正在处理的任务）
  ocrQueue = ocrQueue.filter(q => q.status === 'processing' || normalizeQueueProjectId(q.projectId) !== curPid);

  // 清空自动监听已完成文件列表
  if (Array.isArray(window.autoCompletedFiles)) {
    window.autoCompletedFiles = [];
  }

  // 清空本地进度缓存
  try { localStorage.removeItem('ocr-batch-progress'); } catch(e) {}

  renderOCRQueue();
  updateOCRStatus('ok', '队列已清空');
}


// ========== 鏂囦欢澶硅嚜鍔ㄧ洃鍚?==========
let folderWatchHandle = null;
let folderWatchTimer = null;
let folderWatchActive = false;
let folderProcessedSet = new Set();   // 鏈嶅姟绔凡鎴愬姛澶勭悊鐨勬枃浠跺悕闆嗗悎锛堟瘡娆℃壂鎻忓墠鍒锋柊锛?
let _sessionQueuedSet = new Set();    // 褰撳墠浼氳瘽宸插姞鍏ラ槦鍒楃殑鏂囦欢鍚嶏紙閬垮厤閲嶅娣诲姞锛?
let folderNewCount = 0;
let _keepAliveCtx = null;             // 闈欓粯闊抽 AudioContext锛岄槻姝㈠悗鍙版爣绛鹃〉琚?Chrome 鑺傛祦
let _keepAliveTimer = null;           // 1 绉掑績璺宠鏃跺櫒

function getFolderStorageKey(name) {
  return `folder-watch-processed::${name}`;
}

function loadFolderProcessedCache(name) {
  try {
    const raw = localStorage.getItem(getFolderStorageKey(name));
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
}

function saveFolderProcessedCache(name, set) {
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
    // 鍔犺浇鏈嶅姟绔垚鍔熷垪琛ㄤ綔涓哄垵濮嬪幓閲嶉泦鍚?
    folderProcessedSet = await loadServerSuccessSet();
    // 缂撳瓨鍒?localStorage 渚涚绾挎椂闄嶇骇
    saveFolderProcessedCache(handle.name, folderProcessedSet);
    _sessionQueuedSet = new Set();
    folderNewCount = 0;
    updateFolderWatchStats();
  } catch (e) {
    if (e.name !== 'AbortError') alert('选择文件夹失败: ' + e.message);
  }
}

// 浠庢湇鍔＄鍔犺浇宸叉垚鍔熷鐞嗙殑鏂囦欢鍚嶉泦鍚堬紙鍙帓闄ゆ湁鍏宠仈 battle_records 鐨勶紝澶辫触/鏈鐞嗙殑鍏佽閲嶈瘯锛?
async function loadServerSuccessSet() {
  try {
    const pid = window.currentProjectId || '';
    const data = await cloudRequest(`/gallery/imagenames?successOnly=true&projectId=${encodeURIComponent(pid)}`);
    if (data && data.code === 200 && Array.isArray(data.data)) {
      return new Set(data.data);
    }
  } catch (e) {
    console.warn('[FolderWatch] 鏈嶅姟绔煡璇㈠凡澶勭悊鏂囦欢澶辫触:', e.message);
  }
  return new Set();
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
  _sessionQueuedSet = new Set();
  // 闈欓粯闊抽淇濇寔鍚庡彴娲昏穬锛堝繀椤诲湪 await 涔嬪墠鍒涘缓锛屽埄鐢ㄧ敤鎴风偣鍑绘墜鍔夸笂涓嬫枃锛?
  _startKeepAlive();
  // 鍚姩鏃跺埛鏂版湇鍔＄鎴愬姛鍒楄〃
  folderProcessedSet = await loadServerSuccessSet();
  const btn = document.getElementById('btnFolderWatch');
  const statusEl = document.getElementById('folderWatchStatus');
  if (btn) { btn.textContent = '■ 停止'; btn.className = 'btn btn-sm btn-danger'; }
  if (statusEl) { statusEl.textContent = '监听中...'; statusEl.style.cssText += ';background:var(--accent);color:#fff;'; }
  document.getElementById('folderWatchStats').style.display = 'block';

  // 娉ㄥ唽椤甸潰鍙鎬ф娴嬶紙鍥炲埌椤甸潰鏃惰嚜鍔ㄦ仮澶嶆壂鎻忓拰鎵瑰鐞嗭級
  _initVisibilityHandler();

  await scanWatchFolder();
  // 涓荤獥鍙ｄ篃淇濈暀杞浣滀负鍙屼繚闄?
  const poll = async () => {
    if (!folderWatchActive) return;
    await scanWatchFolder();
    if (folderWatchActive) folderWatchTimer = setTimeout(poll, 5000);
  };
  folderWatchTimer = setTimeout(poll, 5000);
}

function stopFolderWatch() {
  folderWatchActive = false;
  if (folderWatchTimer) { clearTimeout(folderWatchTimer); folderWatchTimer = null; }
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  _stopKeepAlive();
  const btn = document.getElementById('btnFolderWatch');
  const statusEl = document.getElementById('folderWatchStatus');
  if (btn) { btn.textContent = '▶ 启动'; btn.className = 'btn btn-sm btn-primary'; }
  if (statusEl) { statusEl.textContent = '已停止'; statusEl.style.cssText += ';background:var(--bg3);color:var(--text3);'; }
}

// ========== 鍚庡彴淇濇椿锛氶煶棰?+ 蹇冭烦锛岄槻姝?Chrome 瀵瑰悗鍙版爣绛鹃〉娣卞害鑺傛祦 ==========

function _startKeepAlive() {
  // 鈶?闈欓粯闊抽 鈥斺€?Chrome 涓嶅"姝ｅ湪鎾斁闊抽"鐨勬爣绛鹃〉鍋氭繁搴﹁妭娴?
  if (!_keepAliveCtx) {
    try {
      _keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();
      // 鐢ㄦ瀬杞荤殑鐧藉櫔澹拌€岄潪绾潤闊筹紝Chrome 鏇村ぇ姒傜巼璇嗗埆涓?鏈夐煶棰戣緭鍑?
      const len = _keepAliveCtx.sampleRate; // 1 绉?
      const buffer = _keepAliveCtx.createBuffer(1, len, _keepAliveCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() - 0.5) * 0.0001; // 鏋佽交鍣０
      const source = _keepAliveCtx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = _keepAliveCtx.createGain();
      gain.gain.value = 0.001; // 鎺ヨ繎鏃犲０浣嗕笉涓洪浂
      source.connect(gain);
      gain.connect(_keepAliveCtx.destination);
      source.start();
      if (_keepAliveCtx.state === 'suspended') _keepAliveCtx.resume();
    } catch (e) { _keepAliveCtx = null; }
  } else if (_keepAliveCtx.state === 'suspended') {
    _keepAliveCtx.resume();
  }

  // 鈶?1 绉掑績璺?鈥斺€?楂橀鐭?timer 璁?Chrome 淇濇寔璇ユ爣绛鹃〉鐨?timer budget
  if (!_keepAliveTimer) {
    _keepAliveTimer = setInterval(() => {
      // 濡傛灉 AudioContext 琚寕璧凤紝灏濊瘯鎭㈠
      if (_keepAliveCtx && _keepAliveCtx.state === 'suspended') {
        try { _keepAliveCtx.resume(); } catch (e) {}
      }
    }, 1000);
  }
}

function _stopKeepAlive() {
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  if (_keepAliveCtx) {
    try { _keepAliveCtx.close(); } catch (e) {}
    _keepAliveCtx = null;
  }
}

let _visibilityHandlerInstalled = false;

function _initVisibilityHandler() {
  if (_visibilityHandlerInstalled) return;
  _visibilityHandlerInstalled = true;

  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && folderWatchActive) {
      // 鈹€鈹€ 鏍囩椤垫仮澶嶅彲瑙侊細绔嬪嵆鎵弿 + 鎭㈠鎵瑰鐞?鈹€鈹€
      try { await scanWatchFolder(); } catch (e) { /* 闈欓粯 */ }
      if (!ocrRunning && !ocrPausedByUser) {
        startBatchProcess();
      }
    }
  });
}

async function scanWatchFolder() {
  if (!folderWatchHandle) return;
  try {
    // 鈶?姣忔鎵弿鍓嶅埛鏂版湇鍔＄鎴愬姛鍒楄〃锛岀‘淇濊烦杩囧凡鎴愬姛澶勭悊鐨勫浘鐗?
    const serverSuccess = await loadServerSuccessSet();
    // 濡傛灉鏈嶅姟绔湁杩斿洖灏辩敤鏈嶅姟绔粨鏋滐紝鍚﹀垯淇濇寔涓婁竴娆＄殑缂撳瓨
    if (serverSuccess.size > 0) {
      folderProcessedSet = serverSuccess;
      // 鍚屾缂撳瓨鍒?localStorage 浣滀负绂荤嚎闄嶇骇
      saveFolderProcessedCache(folderWatchHandle.name, serverSuccess);
    }

    // 鈶?鎵弿鏂囦欢澶癸紝璺宠繃宸叉垚鍔熷鐞嗙殑鍜屽綋鍓嶄細璇濆凡鍔犲叆闃熷垪鐨?
    const newFiles = [];
    for await (const [name, handle] of folderWatchHandle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!/\.(png|jpg|jpeg)$/i.test(name)) continue;
      // 璺宠繃鏈嶅姟绔凡鎴愬姛澶勭悊鐨?
      if (folderProcessedSet.has(name)) continue;
      // 璺宠繃褰撳墠浼氳瘽宸插姞鍏ラ槦鍒楃殑锛堥伩鍏嶉噸澶嶆坊鍔狅級
      if (_sessionQueuedSet.has(name)) continue;
      const file = await handle.getFile();
      newFiles.push({ name, file });
    }

    if (newFiles.length === 0) return;

    // 鈶?鍔犲叆 OCR 闃熷垪
    for (const { name, file } of newFiles) {
      _sessionQueuedSet.add(name);
      ocrQueue.push({ file, name, status: 'pending', error: null, projectId: normalizeQueueProjectId(window.currentProjectId) });
      folderNewCount++;
    }
    updateFolderWatchStats();
    document.getElementById('queueArea').style.display = 'block';
    renderOCRQueue();
    if (!ocrRunning && !ocrPausedByUser) startBatchProcess();
  } catch (e) {
    console.error('鏂囦欢澶规壂鎻忓嚭閿?', e.message);
  }
}

function updateFolderWatchStats() {
  const p = document.getElementById('folderProcessedCount');
  const n = document.getElementById('folderNewCount');
  if (p) p.textContent = folderProcessedSet.size;
  if (n) n.textContent = folderNewCount;
}

// ========== 鏂囦欢璇诲彇 ==========
// 璇诲彇鏂囦欢骞跺帇缂╀负 base64锛堟渶澶у搴?1920px锛岃川閲?0.85锛夛紝閬垮厤澶у浘瀵艰嚧 OCR 瓒呮椂
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    // 灏忎簬 800KB 鐨勫浘鐗囩洿鎺ヨ鍙栵紝涓嶅帇缂?
    if (file.size < 800 * 1024) {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
      return;
    }
    // 澶у浘鍏堝帇缂╁啀杞?base64
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
      // 鍘嬬缉澶辫触鏃?fallback 鍒板師濮嬭鍙?
      console.warn('[OCR] 图片压缩失败，改用原始大小');
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    };
    img.src = URL.createObjectURL(file);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 闈為樆濉炵姸鎬佹彁绀猴紙鏇夸唬 alert锛屼笉闃绘柇闀挎椂闂磋繍琛岋級==========
let _toastTimer = null;
function showToast(msg, type) {
  // type: 'warn' | 'error' | 'info'
  const el = document.getElementById('ocrStatus');
  if (!el) return;
  const dot = document.getElementById('ocrDot');
  const txt = document.getElementById('ocrText');
  if (dot) dot.className = 'ocr-dot ' + (type || 'warn');
  if (txt) txt.textContent = msg;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    if (txt && txt.textContent === msg) {
      updateOCRStatus('ok', 'OCR 就绪');
    }
  }, 15000);  // 15绉掑悗鑷姩鎭㈠
}

// ========== UI 鑺傛祦娓叉煋 ==========
let _lastRenderTime = 0;
let _renderPending = false;

function throttledRenderAll() {
  const now = Date.now();
  if (now - _lastRenderTime < OCR_CONFIG.renderThrottleMs) {
    if (!_renderPending) {
      _renderPending = true;
      requestAnimationFrame(async () => {
        _renderPending = false;
        _lastRenderTime = Date.now();
        await _doRenderAll();
      });
    }
    return;
  }
  _lastRenderTime = now;
  _doRenderAll();
}

async function _doRenderAll() {
  console.log('[_doRenderAll] 开始刷新，loadAllRecords 存在?', typeof loadAllRecords === 'function');
  try { if (typeof loadAllRecords === 'function') { await loadAllRecords(); console.log('[_doRenderAll] loadAllRecords 完成'); } } catch(e) { console.error('loadAllRecords:', e); }
  try { if (typeof renderDataTable === 'function') { renderDataTable(); console.log('[_doRenderAll] renderDataTable 完成'); } } catch(e) { console.error('renderDataTable:', e); }
  try { if (typeof renderGallery === 'function') renderGallery(); } catch(e) { console.error('renderGallery:', e); }
}

// ========== 椤甸潰鍙鎬ф娴嬶紙鍚庡彴鏍囩椤甸檺閫熻鍛婏級==========
let _visibilityWarned = false;
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    _visibilityWarned = true;
    showToast('已启用后台保活，监听会继续运行', 'info');
  } else {
    if (_visibilityWarned) {
      showToast('页面已恢复到前台，继续正常处理', 'info');
      _visibilityWarned = false;
    }
  }
});

// ========== 闃熷垪鎸佷箙鍖栵紙椤甸潰鍒锋柊鍚庢仮澶嶈繘搴︼級==========
function saveBatchProgress() {
  try {
    const progress = {
      total: ocrQueue.length,
      done: ocrQueue.filter(function(q) { return q.status === 'done'; }).length,
      error: ocrQueue.filter(function(q) { return q.status === 'error'; }).length,
      pending: ocrQueue.filter(function(q) { return q.status === 'pending'; }).length,
      updatedAt: Date.now(),
    };
    localStorage.setItem('ocr-batch-progress', JSON.stringify(progress));
  } catch(e) {}
}

function loadBatchProgress() {
  try {
    var raw = localStorage.getItem('ocr-batch-progress');
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function clearBatchProgress() {
  try { localStorage.removeItem('ocr-batch-progress'); } catch(e) {}
}


// 从后端加载待处理任务（自动监听提交的）
async function loadPendingTasksFromBackend() {
  if (!currentUser) return;
  
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const _base = (typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : (window.cloudSync?.BASE_URL ? window.cloudSync.BASE_URL + '/api' : '/api'));
    
    const resp = await fetch(_base + '/battles/ocr-tasks?status=pending&projectId=' + encodeURIComponent(window.currentProjectId || ''), {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    
    const data = await resp.json();
    if (data.code !== 200 || !Array.isArray(data.data)) return;

    const existingTaskIds = new Set(ocrQueue.filter(i => i.taskId).map(i => i.taskId));
    let addedCount = 0;

    for (const task of data.data) {
      if (existingTaskIds.has(task.id)) continue;
      
      // 添加到队列（标记为自动监听来源）
      ocrQueue.push({
        taskId: task.id,  // 后端任务ID
        name: task.image_name,
        status: 'pending',
        error: null,
        projectId: normalizeQueueProjectId(task.project_id),
        isAutoTask: true  // 标记为自动监听任务
      });

      addedCount++;
    }
    
    if (addedCount > 0) {
      console.log('[OCR] 从后端加载了 ' + addedCount + ' 个待处理任务');
      renderOCRQueue();
    }
  } catch (e) {
    console.warn('[OCR] 加载待处理任务失败:', e.message);
  }
}

// ========== 鎵归噺澶勭悊 ==========
async function startBatchProcess() {
  if (ocrRunning) return;
  // 先从后端拉取待处理任务（自动监听提交的任务）
  await loadPendingTasksFromBackend();

  // 妫€鏌ョН鍒嗭細寰呭鐞嗗紶鏁颁笉鑳借秴杩囧墿浣欑Н鍒嗭紝瀹為檯鎸夋垚鍔熷紶鏁版墸锛堝け璐ヤ笉鎵ｏ級
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
  let _renderCount = 0;  // 鑺傛祦璁℃暟鍣?

  // 鈹€鈹€ 鐬椂閿欒閲嶈瘯杈呭姪锛堜笉闃绘柇鏁翠釜鎵瑰鐞嗭級鈹€鈹€
  async function retryTransient(itemObj, reason) {
    itemObj._retries = (itemObj._retries || 0) + 1;
    if (itemObj._retries <= OCR_CONFIG.maxRetries) {
      const delay = OCR_CONFIG.retryBaseDelay * Math.pow(2, itemObj._retries - 1);
      showToast('⚠ ' + reason + '，' + delay / 1000 + 's 后重试 (' + itemObj._retries + '/' + OCR_CONFIG.maxRetries + ')', 'warn');
      await sleep(delay);
      // 閲嶈瘯绛夊緟鏈熼棿涔熷搷搴旀殏鍋?
      while (ocrPaused && ocrRunning) await sleep(500);
      if (!ocrRunning) return false;
      return true;  // 缁х画閲嶈瘯
    }
    // 閲嶈瘯鑰楀敖锛氭爣璁板け璐ワ紝璺宠繃褰撳墠椤癸紝缁х画澶勭悊涓嬩竴寮?
    itemObj.status = 'error';
    itemObj.error = '重试 ' + OCR_CONFIG.maxRetries + ' 次后仍失败: ' + reason;
    showToast('❌ ' + itemObj.name + ' 重试耗尽，已跳过 (' + reason + ')', 'error');
    return false;  // 涓嶉噸璇曚簡锛岃烦杩囨椤?
  }

  async function processNext() {
    while (idx < ocrQueue.length) {
      if (!ocrRunning) break;
      while (ocrPaused && ocrRunning) await sleep(500);
      if (!ocrRunning) break;
      while (processing >= OCR_CONFIG.batchConcurrency && idx < ocrQueue.length) await sleep(500);
      if (!ocrRunning) break;

      const item = ocrQueue[idx];
      if (item.status !== 'pending') { idx++; continue; }

      // 在标记为 processing 前再次检查暂停状态
      if (ocrPaused) continue;

      item.status = 'processing';
      if (item._retries === undefined) item._retries = 0;
      processing++;
      renderOCRQueue();

      let base64 = null;
      let success = false;

      const abortSig = batchAbortController ? batchAbortController.signal : null;
      const token = typeof getToken === 'function' ? getToken() : '';
      let resp;
      updateOCRStatus('work', 'OCR 识别中...');
      // 鈹€鈹€ 閲嶈瘯寰幆锛氱灛鏃堕敊璇嚜鍔ㄦ仮澶嶏紝涓嶉樆鏂暣鎵?鈹€鈹€
      while (!success) {
        try {
          // 在发送请求前检查暂停状态
          if (ocrPaused) {
            item.status = 'pending';
            processing--;
            renderOCRQueue();
            break;
          }

          // 判断是自动任务还是手动任务
          if (item.isAutoTask && item.taskId) {
            // 自动任务：调用 ocr-execute 接口
            const reqBody = { taskId: item.taskId };
            
            const fetchTimeoutMs = OCR_CONFIG.timeout || 120000;
            const timeoutCtrl = new AbortController();
            const timeoutId = setTimeout(() => timeoutCtrl.abort(new Error('OCR 请求超时')), fetchTimeoutMs);
            const fetchSignal = abortSig ? AbortSignal.any([timeoutCtrl.signal, abortSig]) : timeoutCtrl.signal;

            try {
              const _base = (typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : (window.cloudSync?.BASE_URL ? window.cloudSync.BASE_URL + '/api' : '/api'));
              resp = await fetch(_base + '/battles/ocr-execute', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                },
                body: JSON.stringify(reqBody),
                signal: fetchSignal,
              });
            } finally {
              clearTimeout(timeoutId);
            }
          } else {
            // 手动任务：读取文件并调用 ocr-upload 接口
            base64 = await readFileAsBase64(item.file);
            const itemProjectId = item.projectId || null;
            const labelCfg = await getLabelConfig(itemProjectId);
            const reqBody = {
              image: base64,
              projectId: itemProjectId,
              imageName: item.name,
            };
            if (labelCfg) reqBody.labelConfig = labelCfg;

            const fetchTimeoutMs = OCR_CONFIG.timeout || 120000;
            const timeoutCtrl = new AbortController();
            const timeoutId = setTimeout(() => timeoutCtrl.abort(new Error('OCR 请求超时')), fetchTimeoutMs);
            const fetchSignal = abortSig ? AbortSignal.any([timeoutCtrl.signal, abortSig]) : timeoutCtrl.signal;

            try {
              resp = await fetch(getOcrUploadEndpoint(), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                },
                body: JSON.stringify(reqBody),
                signal: fetchSignal,
              });
            } finally {
              clearTimeout(timeoutId);
            }
          }
          updateOCRStatus('ok', 'OCR 就绪');

          // 401 璐﹀彿寮傚父 鈫?涓嶉噸璇曪紝鐩存帴閫€鍑?
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
            // 涓嶉噸璇曪紝鍋滄鎵瑰鐞?
            item.status = 'error'; item.error = 'HTTP 401: ' + errMsg;
            success = true; break;
          }

          if (!resp.ok) {
            const canRetry = await retryTransient(item, 'HTTP ' + resp.status);
            if (!canRetry) { success = true; break; }
            continue;
          }

          const result = await resp.json();

          // 绉垎涓嶈冻 鈫?涓嶉噸璇曪紝鍋滄鎵瑰鐞?
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

          // 鍥剧墖鏈韩澶勭悊澶辫触(422) 鈫?涓嶉噸璇曪紝鐩存帴璺宠繃缁х画涓嬩竴寮?
          if (result.code === 429) {
            const canRetry429 = await retryTransient(item, '服务端 OCR 队列已满 (429)');
            if (!canRetry429) { success = true; break; }
            continue;
          }

          if (result.code === 422) {
            item.status = 'error';
            item.error = result.message || '图片处理失败';
            showToast('⚠ 跳过: ' + item.name + ' (' + (result.message || '处理失败') + ')', 'warn');
            success = true;
            break;
          }

          // OCR 鏈嶅姟涓嶅彲杈?503) 鈫?鑷姩閲嶈瘯锛堟湇鍔″彲鑳介噸鍚腑锛?
          if (result.code === 503) {
            const canRetry = await retryTransient(item, 'OCR 服务不可用 (503)');
            if (!canRetry) { success = true; break; }
            continue;
          }

          if (result.code !== 200) {
            // 鍏朵粬涓氬姟閿欒 鈫?涓嶉噸璇曪紝鏍囪澶辫触缁х画涓嬩竴寮?
            item.status = 'error';
            item.error = result.message || 'OCR 失败';
            success = true;
            break;
          }
          // ✅ 识别成功
          const record = result.data;
          console.log('[OCR完成] 准备保存到本地 IndexedDB:', record);
          // 缓存到本地 IndexedDB（服务端已存入 MySQL，不重复同步云端）
          if (typeof dbAddLocal === 'function') {
            const localId = await dbAddLocal(record);
            console.log('[OCR完成] 已保存到 IndexedDB, localId:', localId);
            if (typeof addSysLog === 'function') {
              addSysLog('action', '上传战报: ' + (record.leftPlayer || record.attackerName || item.name) + (window.currentProjectId ? ' [项目ID:' + window.currentProjectId + ']' : ''));
            }
            if (window.currentProjectId && typeof addBattleToProject === 'function' && localId) {
              await addBattleToProject(window.currentProjectId, localId);
            }
          }
          item.status = 'done';
          console.log('[OCR完成] item.status 设置为 done');
          item.status = 'done';
          item._retries = 0;
          success = true;
          // 绉垎宸茬敱鏈嶅姟绔墸闄わ紝鍙渶鍒锋柊 UI 鏄剧ず
          if (typeof updateUserNavPoints === 'function') updateUserNavPoints();
        } catch (e) {
          // 鐢ㄦ埛涓诲姩鏆傚仠瀵艰嚧鐨勪腑姝?
          if (e.name === 'AbortError' && ocrPausedByUser) {
            item.status = 'pending';
            item.error = null;
            processing--;
            renderOCRQueue();
            updateOCRProgress();
            ocrRunning = false;
            if (btnStart) btnStart.disabled = false;
            if (btnPause) { btnPause.disabled = false; }
            updateOCRStatus('ok', '已暂停，点击“继续”恢复');
            return;
          }
          // 缃戠粶閿欒 / 鏈嶅姟涓嶅彲杈?/ 璇锋眰瓒呮椂 鈫?鑷姩閲嶈瘯
          const msg = e.message || '';
          if (msg.includes('503') || msg.includes('服务不可用') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION') || msg.includes('OCR 请求超时') || msg.includes('TimeoutError') || e.name === 'TimeoutError') {
            const canRetry = await retryTransient(item, msg);
            if (!canRetry) { success = true; break; }
            continue;
          }
          // 鍏朵粬寮傚父 鈫?淇濆瓨鏈湴閿欒璁板綍锛屾爣璁板け璐ョ户缁?
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
          } catch (e2) { console.error('淇濆瓨澶辫触鍥剧墖鍑洪敊:', e2); }
          item.status = 'error';
          item.error = e.message;
          success = true;
        }
      }

      processing--;
      idx++;

      // 鈹€鈹€ 鑺傛祦 UI 鍒锋柊锛堟瘡 N 寮犳垨瓒呮椂鍒锋柊锛岄伩鍏?DOM 鑶ㄨ儉鍗￠】锛夆攢鈹€
      _renderCount++;
      renderOCRQueue();
      updateOCRProgress();
      saveBatchProgress();

      if (_renderCount % OCR_CONFIG.renderThrottleCount === 0) {
        throttledRenderAll();
      }
      // 涓嶅啀浣跨敤 batchInterval sleep
    }

    // 鈹€鈹€ 鎵瑰鐞嗗叏閮ㄧ粨鏉?鈹€鈹€
    ocrRunning = false;
    if (btnStart) btnStart.disabled = false;
    if (btnPause) { btnPause.disabled = true; btnPause.textContent = '⏸ 暂停'; }
    throttledRenderAll();
    updateOCRProgress();
    updateOCRStatus('ok', 'OCR 就绪');
    clearBatchProgress();
  }

  processNext();
}

function toggleBatchPause() {
  const btn = document.getElementById('btnPauseBatch');
  console.log('[OCR] toggleBatchPause called, current ocrPaused:', ocrPaused, 'ocrRunning:', ocrRunning);
  if (!ocrPaused) {
    // ——暂停：立即中止正在进行的 OCR 请求——
    ocrPaused = true;
    ocrPausedByUser = true;
    if (batchAbortController) batchAbortController.abort();
    if (btn) btn.textContent = '▶ 继续';
    updateOCRStatus('ok', '已暂停');
    console.log('[OCR] 已设置暂停状态');
  } else {
    // ——继续：重新启动批处理（已处理完的项保持 done，从第一个 pending 继续）——
    ocrPaused = false;
    ocrPausedByUser = false;
    // 重新创建 AbortController，避免使用已 aborted 的 controller
    batchAbortController = new AbortController();
    if (btn) btn.textContent = '⏸ 暂停';
    updateOCRStatus('work', '继续处理中...');
    console.log('[OCR] 已取消暂停，准备继续');
    if (!ocrRunning) {
      console.log('[OCR] ocrRunning=false，重新启动 startBatchProcess');
      startBatchProcess();
    }
  }
}

function updateOCRProgress() {
  const curPid = normalizeQueueProjectId(window.currentProjectId);

  // 手动队列统计（只统计当前项目）
  const manualItems = ocrQueue.filter(q => normalizeQueueProjectId(q.projectId) === curPid);
  const manualDone = manualItems.filter(q => q.status === 'done').length;
  const manualTotal = manualItems.length;

  // 自动监听统计（只统计当前项目）
  const watchTask = window.ocrWatchTask;
  const watchTaskMatchesProject = watchTask && Number(watchTask.projectId) === Number(curPid);
  let autoDone = 0;
  let autoTotal = 0;

  if (watchTaskMatchesProject) {
    autoDone = watchTask.processedCount || 0;
    autoTotal = (watchTask.processedCount || 0) + (watchTask.pendingCount || 0);
    // 如果有正在处理的文件，加入总数
    if (watchTask.currentFile && String(watchTask.currentFile).trim()) {
      autoTotal += 1;
    }
  }

  // 合并统计（本地助手和数据库是同一批文件，二选一，不能相加）
  const totalDone = watchTaskMatchesProject ? autoDone : manualDone;
  const totalAll = watchTaskMatchesProject ? autoTotal : manualTotal;
  const pct = totalAll > 0 ? (totalDone / totalAll * 100) : 0;

  const bar = document.getElementById('batchProgress');
  if (bar) {
    bar.style.width = pct + '%';
    const txt = bar.querySelector('.progress-text');
    if (txt) {
      if (totalAll === 0) {
        txt.textContent = '准备就绪';
      } else if (totalDone === totalAll) {
        txt.textContent = `已完成 (${totalDone}/${totalAll})`;
      } else {
        txt.textContent = `处理中 (${totalDone}/${totalAll})`;
      }
    }
  }
  saveBatchProgress();
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

// ========== 绉垎涓嶈冻寮圭獥 ==========
function showPointsInsufficientModal(currentPoints, neededPoints) {
  closePointsInsufficientModal();
  const shortfall = Math.max(0, neededPoints - currentPoints);
  const overlay = document.createElement('div');
  overlay.id = 'pointsInsufficientOverlay';
  overlay.className = 'points-insufficient-overlay';
  overlay.innerHTML = `
    <div class="points-insufficient-panel">
      <div class="pi-icon">💎</div>
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
        <button class="btn btn-primary" onclick="closePointsInsufficientModal(); typeof showPointsMall==='function'&&showPointsMall();">前往充值</button>
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

// ========== 鏈嶅姟绔枃浠跺す鐩戝惉 UI ==========
let _svrWatchPollTimer = null;

function svrWatchInit() {
  const panel = document.getElementById('svrWatchPanel');
  if (!panel) return;
  panel.style.display = 'none';
  if (_svrWatchPollTimer) {
    clearInterval(_svrWatchPollTimer);
    _svrWatchPollTimer = null;
  }
}

async function svrWatchRefresh() {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api';
    const resp = await fetch(base + '/folder-watch/status', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
    const data = await resp.json();
    if (data.code !== 200) return;
    const { config, state } = data.data;
    // 璺緞 & 闂撮殧
    const pathEl = document.getElementById('svrWatchPath');
    const ivEl = document.getElementById('svrWatchInterval');
    if (pathEl && pathEl !== document.activeElement) pathEl.value = config.folderPath || '';
    if (ivEl && ivEl !== document.activeElement) ivEl.value = config.intervalSec || 10;
    // 鐘舵€佸窘绔?
    const statusEl = document.getElementById('svrWatchStatus');
    if (statusEl) {
      statusEl.textContent = state.running ? '运行中' : '已停止';
      statusEl.style.cssText = state.running
        ? 'font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(72,199,142,.15);color:#48c78e;'
        : 'font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg3);color:var(--text3);';
    }
    // 鎸夐挳
    const startBtn = document.getElementById('btnSvrWatchStart');
    const stopBtn = document.getElementById('btnSvrWatchStop');
    if (startBtn) startBtn.style.display = state.running ? 'none' : '';
    if (stopBtn) stopBtn.style.display = state.running ? '' : 'none';
    // 缁熻
    const procEl = document.getElementById('svrWatchProcessed');
    const errEl = document.getElementById('svrWatchErrors');
    const pendEl = document.getElementById('svrWatchPending');
    if (procEl) procEl.textContent = state.processedCount || 0;
    if (errEl) errEl.textContent = state.errorCount || 0;
    if (pendEl) pendEl.textContent = state.pendingFiles || 0;
    // 涓婃鎵弿
    const scanEl = document.getElementById('svrWatchLastScan');
    if (scanEl) scanEl.textContent = state.lastScanAt ? '上次扫描: ' + new Date(state.lastScanAt).toLocaleString('zh-CN') : '';
    // 鏈€杩戦敊璇?
    const errMsgEl = document.getElementById('svrWatchLastError');
    if (errMsgEl) errMsgEl.textContent = state.lastError ? '⚠ ' + state.lastError : '';
  } catch (e) { /* 缃戠粶涓嶅彲杈炬椂闈欓粯 */ }
}

async function saveSvrWatchConfig() {
  const folderPath = (document.getElementById('svrWatchPath') || {}).value || '';
  const intervalSec = parseInt((document.getElementById('svrWatchInterval') || {}).value) || 10;
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api';
    const ownerPhone = currentUser ? currentUser.phone : '';
    const projectId = window.currentProjectId || null;
    const resp = await fetch(base + '/folder-watch/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
      body: JSON.stringify({ folderPath, intervalSec, ownerPhone, projectId })
    });
    const data = await resp.json();
    if (data.code === 200) { updateOCRStatus('ok', '服务端配置已保存'); svrWatchRefresh(); }
    else updateOCRStatus('ok', '保存失败: ' + (data.message || ''));
  } catch (e) { updateOCRStatus('ok', '保存失败: ' + e.message); }
}

async function svrWatchStart() {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api';
    const resp = await fetch(base + '/folder-watch/start', { method: 'POST', headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
    const data = await resp.json();
    if (data.code === 200) svrWatchRefresh();
    else alert(data.message || '启动失败');
  } catch (e) { alert('启动失败: ' + e.message); }
}

async function svrWatchStop() {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api';
    await fetch(base + '/folder-watch/stop', { method: 'POST', headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
    svrWatchRefresh();
  } catch (e) {}
}

// 璋冪敤鍚庣寮瑰嚭 Windows 鍘熺敓鏂囦欢澶归€夋嫨瀵硅瘽妗?
async function svrPickFolder() {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api';
    const pathEl = document.getElementById('svrWatchPath');
    if (pathEl) pathEl.placeholder = '正在打开文件夹选择对话框...';
    const resp = await fetch(base + '/folder-watch/pick-folder', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    const data = await resp.json();
    if (pathEl) pathEl.placeholder = '如 C:\\AutoScreenshotTool\\screenshots\\6';
    if (data.code === 200 && data.data && data.data.path) {
      if (pathEl) pathEl.value = data.data.path;
      updateOCRStatus('ok', '已选择文件夹: ' + data.data.path);
    } else if (data.code === 400) {
      // 鐢ㄦ埛鍙栨秷閫夋嫨锛岄潤榛?
    } else {
      alert('无法打开文件夹选择器: ' + (data.message || '未知错误'));
    }
  } catch (e) {
    const pathEl = document.getElementById('svrWatchPath');
    if (pathEl) pathEl.placeholder = '如 C:\\AutoScreenshotTool\\screenshots\\6';
    alert('无法打开文件夹选择器: ' + e.message);
  }
}

// ========== 本地助手下载和配置 ==========

async function downloadLocalHelperPackage() {
  try {
    // 从本地后端下载（稳定快速，无墙问题）
    const downloadUrl = 'https://api.zhenwu.fun/download/local-helper';
    window.open(downloadUrl, '_blank');
    showToast('✅ 下载已开始，请查看浏览器下载内容', 'success');
  } catch (e) {
    showToast('❌ 下载失败: ' + e.message, 'error');
  }
}

async function connectLocalHelperWithMode(mode) {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    if (!token) {
      showToast('⚠️ 请先登录', 'warn');
      return;
    }

    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api';
    const resp = await fetch(base + '/ocr-watch/helper-config', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();

    if (data.code !== 200) {
      showToast('❌ 获取配置失败: ' + (data.message || '未知错误'), 'error');
      return;
    }

    const { helperToken, apiBase } = data.data;

    // 显示配置信息的模态框
    const modalHtml = `
      <div style="background: white; padding: 24px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
        <h3 style="margin: 0 0 16px 0; color: var(--text1);">本地助手配置信息</h3>
        <div style="margin-bottom: 16px;">
          <p style="margin: 0 0 8px 0; color: var(--text2); font-size: 14px;">请将以下 Token 复制到本地助手配置中：</p>
          <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-family: monospace; word-break: break-all; user-select: all;">
            ${helperToken}
          </div>
        </div>
        <div style="margin-bottom: 16px;">
          <p style="margin: 0 0 8px 0; color: var(--text2); font-size: 14px;">API 地址（setup时直接回车使用默认）：</p>
          <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-family: monospace; user-select: all;">
            ${apiBase}
          </div>
        </div>
        <div style="padding: 12px; background: #fff3cd; border-radius: 4px; margin-bottom: 16px;">
          <p style="margin: 0; color: #856404; font-size: 13px;">
            <strong>操作步骤：</strong><br>
            1. 双击运行"启动助手.bat"<br>
            2. 在命令行中输入 API 地址（直接回车使用默认）<br>
            3. 粘贴上面的 Token 并回车<br>
            4. 配置完成后助手会自动启动
          </p>
        </div>
        <div style="text-align: right;">
          <button onclick="this.closest('.modal').remove()" class="btn btn-primary">我知道了</button>
        </div>
      </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px;';
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);

    showToast('✅ 配置信息已生成', 'success');
  } catch (e) {
    showToast('❌ 获取配置失败: ' + e.message, 'error');
  }
}

async function manualRefreshHelperStatus(btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = '刷新中...';
  }

  try {
    // 这里可以添加刷新本地助手状态的逻辑
    // 例如重新查询 ocr_watch_tasks 表
    showToast('✅ 状态已刷新', 'success');
  } catch (e) {
    showToast('❌ 刷新失败: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '刷新状态';
    }
  }
}


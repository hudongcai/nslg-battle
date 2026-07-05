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
let helperTaskList = [];
let helperClientStatus = null;
let _helperTaskPollTimer = null;
let _helperTaskEnsuring = false;
let _preGeneratedLinkCode = '';
let _preGeneratedLinkCodeAt = 0;
const LINK_CODE_PREGEN_TTL = 9 * 60 * 1000;  // 9 分钟，后端 10 分钟过期留有余量
let _helperWakeAttemptAt = 0;
let _helperWakeProjectId = null;
let _helperAutoRecordSyncing = false;
let _helperAutoRecordSyncMarker = '';
let _helperLinkBootstrap = null;
const LOCAL_HELPER_DOWNLOAD_URL = (typeof CLOUD_API_BASE !== 'undefined' && CLOUD_API_BASE && /zhenwu\.fun/i.test(location.host))
  ? (location.origin.replace(/\/$/, '') + '/downloads/zhenwu-local-helper-setup.exe')
  : './downloads/zhenwu-local-helper-setup.exe';

function getHelperTaskById(list, id) {
  if (!Array.isArray(list) || !id) return null;
  return list.find(item => Number(item.id) === Number(id)) || null;
}

function getHelperTaskRecordMarker(task) {
  if (!task) return '';
  return [
    task.id || '',
    task.projectId || '',
    task.lastUploadAt || '',
    Number(task.stats?.parsed || 0),
    Number(task.stats?.uploaded || 0)
  ].join('|');
}

async function syncAutoParsedRecordsIfNeeded(previousTasks, nextTasks) {
  const currentTask = Array.isArray(nextTasks) && nextTasks.length ? nextTasks[0] : null;
  if (!currentTask || !currentTask.projectId) return;

  const previousTask = getHelperTaskById(previousTasks, currentTask.id);
  const currentParsed = Number(currentTask.stats?.parsed || 0);
  const previousParsed = Number(previousTask?.stats?.parsed || 0);
  const currentUploaded = Number(currentTask.stats?.uploaded || 0);
  const previousUploaded = Number(previousTask?.stats?.uploaded || 0);
  const hasFreshUpload = !!currentTask.lastUploadAt && currentTask.lastUploadAt !== previousTask?.lastUploadAt;
  const hasFreshSuccess = currentParsed > previousParsed || currentUploaded > previousUploaded;
  if (!hasFreshUpload && !hasFreshSuccess) return;

  const marker = getHelperTaskRecordMarker(currentTask);
  if (!marker || marker === _helperAutoRecordSyncMarker || _helperAutoRecordSyncing) return;

  _helperAutoRecordSyncing = true;
  try {
    if (window.cloudSync && typeof window.cloudSync.syncProjectRecords === 'function') {
      await window.cloudSync.syncProjectRecords(currentTask.projectId);
    }
    if (typeof loadAllRecords === 'function') {
      await loadAllRecords();
    }
    if (typeof renderDataTable === 'function') {
      renderDataTable();
    }
    if (typeof renderGallery === 'function') {
      renderGallery();
    }
    _helperAutoRecordSyncMarker = marker;
  } catch (e) {
    console.warn('[AutoParse] 战报数据自动刷新失败:', e.message || e);
  } finally {
    _helperAutoRecordSyncing = false;
  }
}

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
  startHelperTaskPolling();
}

function showOCRSection() {
  // 鏄剧ず header 涓殑 OCR 鐘舵€佹寚绀哄櫒
  const status = document.getElementById('ocrStatus');
  if (status) status.style.display = 'flex';
}

function getLocalHelperApiBase() {
  return (typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'http://localhost:3000/api') + '/local-helper';
}

function getCurrentHelperProjectId() {
  const pid = Number(window.currentProjectId || 0);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function buildLocalHelperProtocolUrl(action, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      query.set(key, String(value));
    }
  });
  const queryText = query.toString();
  return 'zhenwu-helper://' + action + (queryText ? ('?' + queryText) : '');
}

function openLocalHelperProtocol(action, params = {}, successText) {
  const protocolUrl = buildLocalHelperProtocolUrl(action, params);
  // 使用隐藏 <a> 元素 + click() 触发自定义协议。
  // 不加 target="_blank" — 避免被 Edge/Chrome 弹窗拦截器静默阻止；
  // 已注册的协议处理器被触发后，浏览器不会离开当前页面。
  const a = document.createElement('a');
  a.href = protocolUrl;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (e) {}
  }, 500);
  if (successText) showToast(successText, 'success');
}

function closeHelperActionModal() {
  const mask = document.getElementById('helperActionModal');
  if (mask) mask.remove();
  if (window._helperModalTimer) { clearTimeout(window._helperModalTimer); window._helperModalTimer = null; }
}

function updateHelperActionModalStatus(text) {
  const statusEl = document.getElementById('helperActionModalStatus');
  if (statusEl) statusEl.textContent = text;
}

// 更新弹窗主标题（更醒目），同时更新副标题
function updateHelperActionModalTitle(title, subtitle) {
  const titleEl = document.getElementById('helperActionModalTitle');
  if (titleEl) titleEl.textContent = title;
  if (subtitle) {
    const statusEl = document.getElementById('helperActionModalStatus');
    if (statusEl) statusEl.textContent = subtitle;
  }
}

function showHelperActionModal(message, loading) {
  closeHelperActionModal();
  const mask = document.createElement('div');
  mask.id = 'helperActionModal';
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.48);backdrop-filter:blur(3px);z-index:10030;display:flex;align-items:center;justify-content:center;padding:16px;';
  mask.innerHTML = `
    <div style="width:min(360px,100%);background:linear-gradient(135deg,var(--bg2),rgba(26,32,56,.98));border:1px solid rgba(240,180,41,.26);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.05);padding:24px 22px;text-align:center;">
      ${loading ? '<div style="width:34px;height:34px;border:3px solid rgba(240,180,41,.22);border-top-color:var(--accent);border-radius:50%;margin:0 auto 14px;animation:helperSpin .8s linear infinite;"></div>' : ''}
      <div id="helperActionModalTitle" style="font-size:16px;font-weight:800;color:var(--text1);">${escHtml(message)}</div>
      ${loading ? '<div id="helperActionModalStatus" style="font-size:13px;color:var(--accent);margin-top:10px;font-weight:600;">请稍等，正在自动完成关联</div>' : '<button type="button" class="btn btn-sm btn-primary" style="margin:18px auto 0;min-width:112px;height:36px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;text-align:center;box-shadow:0 8px 22px rgba(240,180,41,.18);" onclick="closeHelperActionModal()">确认</button>'}
    </div>
  `;
  if (!document.getElementById('helperActionModalStyle')) {
    const style = document.createElement('style');
    style.id = 'helperActionModalStyle';
    style.textContent = '@keyframes helperSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
  document.body.appendChild(mask);
}

function sleepHelper(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForLinkTokenConsumed(linkToken, timeoutMs) {
  const token = typeof getToken === 'function' ? getToken() : '';
  const code = String(linkToken || '').trim();
  if (!token || !code) return false;
  const projectId = getCurrentHelperProjectId();
  const url = getLocalHelperApiBase() + '/link-token/status?token=' + encodeURIComponent(code) + (projectId ? ('&projectId=' + encodeURIComponent(projectId)) : '');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const resp = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json();
      if (data.code === 200 && data.data) {
        if (data.data.used) return data.data;
        if (data.data.expired) return null;
      }
    } catch (e) {}
    await sleepHelper(1000);
  }
  return null;
}

function applyHelperLinkBootstrap(linkState) {
  if (!linkState || !linkState.used) return;
  const projectId = Number(linkState.projectId || getCurrentHelperProjectId() || 0) || null;
  const activeClient = {
    id: Number(linkState.clientId || 0) || null,
    deviceName: linkState.deviceName || '本地助手',
    status: 'online',
    lastSeenAt: linkState.usedAt || new Date().toISOString(),
    updatedAt: linkState.usedAt || new Date().toISOString()
  };
  helperClientStatus = {
    connected: true,
    activeClient,
    clients: [activeClient]
  };
  _helperLinkBootstrap = {
    projectId,
    activeClient,
    task: linkState.task ? Object.assign({ stats: linkState.task.stats || {} }, linkState.task) : null
  };
  if (linkState.task && projectId) {
    const otherTasks = Array.isArray(helperTaskList) ? helperTaskList.filter(item => Number(item.projectId || 0) !== Number(projectId)) : [];
    helperTaskList = [Object.assign({ stats: linkState.task.stats || {} }, linkState.task), ...otherTasks];
  }
}

async function hydrateHelperStateAfterLink(projectId) {
  const normalizedProjectId = Number(projectId || getCurrentHelperProjectId() || 0) || null;
  for (let i = 1; i <= 5; i++) {
    updateHelperActionModalTitle('步骤 4/4：同步任务状态 (' + i + '/5)', '正在刷新本地助手任务列表…');
    await refreshHelperTasks(true);
    const matchedTask = Array.isArray(helperTaskList)
      ? helperTaskList.find(item => Number(item.projectId || 0) === Number(normalizedProjectId || 0))
      : null;
    const active = helperClientStatus && helperClientStatus.activeClient;
    if (matchedTask && active) {
      _helperLinkBootstrap = null;
      return true;
    }
    if (i < 5) {
      updateHelperActionModalTitle('步骤 4/4：等待就绪 (' + i + '/5)', '800ms 后重试…');
      await sleepHelper(800);
    }
  }
  updateHelperActionModalTitle('步骤 4/4：同步完成', '正在刷新面板…');
  renderHelperTaskPanel();
  renderOCRQueue();
  return false;
}

async function waitForHelperConnected(timeoutMs) {
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) return false;
  const projectId = getCurrentHelperProjectId();
  const taskUrl = new URL(getLocalHelperApiBase() + '/tasks', window.location.origin);
  if (projectId) taskUrl.searchParams.set('projectId', String(projectId));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const [statusResp, taskResp] = await Promise.all([
        fetch(getLocalHelperApiBase() + '/status', { headers: { 'Authorization': 'Bearer ' + token } }),
        fetch(taskUrl.toString(), { headers: { 'Authorization': 'Bearer ' + token } })
      ]);
      const statusData = await statusResp.json();
      const taskData = await taskResp.json();
      if (statusData.code === 200) {
        helperClientStatus = statusData.data || null;
        let active = helperClientStatus && helperClientStatus.activeClient;
        if (!active && helperClientStatus && Array.isArray(helperClientStatus.clients)) {
          active = helperClientStatus.clients.find(client => isHelperSeenRecently(client.lastSeenAt, 120000)) || null;
          if (active) helperClientStatus.activeClient = active;
        }
      }
      if (taskData.code === 200) {
        helperTaskList = Array.isArray(taskData.data) ? taskData.data : [];
      }
      renderHelperTaskPanel();
      const active = helperClientStatus && helperClientStatus.activeClient;
      const taskLinked = helperTaskList.some(task =>
        Number(task.projectId || 0) === Number(projectId || 0) &&
        (task.helperClientId || isHelperSeenRecently(task.lastHeartbeatAt, 120000))
      );
      if ((helperClientStatus && helperClientStatus.connected && active) ||
          (active && isHelperSeenRecently(active.lastSeenAt, 120000)) ||
          taskLinked) {
        await refreshHelperTasks(true);
        return true;
      }
    } catch (e) {}
    await sleepHelper(1000);
  }
  return false;
}

function maybeWakeLocalHelper(projectId) {
  const now = Date.now();
  const hasKnownClient = !!(helperClientStatus && Array.isArray(helperClientStatus.clients) && helperClientStatus.clients.length);
  const active = helperClientStatus && helperClientStatus.activeClient;
  if (!projectId || !hasKnownClient || active) return;
  if (_helperWakeProjectId === projectId && (now - _helperWakeAttemptAt) < 30000) return;
  _helperWakeAttemptAt = now;
  _helperWakeProjectId = projectId;
  openLocalHelperProtocol('open', { projectId }, '正在尝试唤起本地助手并恢复当前项目连接');
}

function normalizeQueueProjectId(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') return null;
  const trimmed = String(projectId).trim();
  const num = Number(trimmed);
  return Number.isFinite(num) && String(num) === trimmed ? num : trimmed;
}

function startHelperTaskPolling() {
  if (_helperTaskPollTimer) clearInterval(_helperTaskPollTimer);
  if (!currentUser) return;
  refreshHelperTasks();
  preGenerateHelperLinkCode();  // 后台预生成链接码
  _helperTaskPollTimer = setInterval(() => {
    if (!currentUser) return;
    refreshHelperTasks(true);
  }, 10000);
}

async function refreshHelperTasks(silent) {
  if (!currentUser) return;
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) {
    if (!silent) {
      const setupEl = document.getElementById('helperSetupStatus');
      if (setupEl) {
        setupEl.innerHTML = '<div style="font-size:12px;color:var(--orange);padding:10px 12px;border:1px dashed var(--border);border-radius:8px;">登录状态没有恢复完整，正在重新获取本地助手状态，请稍后再点一次刷新状态。</div>';
      }
    }
    return;
  }
  const projectId = getCurrentHelperProjectId();
  if (projectId) {
    await ensureProjectHelperTask(projectId, silent);
  }
  const taskUrl = new URL(getLocalHelperApiBase() + '/tasks', window.location.origin);
  if (projectId) taskUrl.searchParams.set('projectId', String(projectId));
  try {
    const previousTasks = Array.isArray(helperTaskList) ? helperTaskList.slice() : [];
    const [statusResp, taskResp] = await Promise.all([
      fetch(getLocalHelperApiBase() + '/status', { headers: { 'Authorization': 'Bearer ' + token } }),
      fetch(taskUrl.toString(), { headers: { 'Authorization': 'Bearer ' + token } })
    ]);
    const statusData = await statusResp.json();
    const taskData = await taskResp.json();
    if (statusData.code === 200) helperClientStatus = statusData.data || null;
    if (taskData.code === 200) {
      helperTaskList = Array.isArray(taskData.data) ? taskData.data : [];
      await syncAutoParsedRecordsIfNeeded(previousTasks, helperTaskList);
    }
    renderHelperTaskPanel();
    renderOCRQueue();
    preGenerateHelperLinkCode();  // 后台刷新预生成链接码缓存
  } catch (e) {
    if (!silent) updateOCRStatus('ok', '助手任务刷新失败: ' + e.message);
  }
}

async function manualRefreshHelperStatus(btn) {
  const button = btn || null;
  const setupEl = document.getElementById('helperSetupStatus');
  const originalText = button ? button.textContent : '';
  const originalSetupHTML = setupEl ? setupEl.innerHTML : '';
  if (button) {
    button.disabled = true;
    button.textContent = '刷新中...';
    button.style.opacity = '0.7';
  }
  if (setupEl) {
    setupEl.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:10px 12px;border:1px dashed var(--border);border-radius:8px;">正在刷新本地助手状态...</div>';
  }
  try {
    await refreshHelperTasks(false);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || '刷新状态';
      button.style.opacity = '';
    }
    // 如果 refreshHelperTasks 提前返回或失败导致 setupEl 未更新，恢复原始状态
    if (setupEl && setupEl.innerHTML.indexOf('正在刷新本地助手状态') !== -1) {
      setupEl.innerHTML = originalSetupHTML;
    }
  }
}

async function ensureProjectHelperTask(projectId, silent) {
  if (_helperTaskEnsuring || !projectId) return;
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) return;
  _helperTaskEnsuring = true;
  try {
    const resp = await fetch(getLocalHelperApiBase() + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ projectId })
    });
    const data = await resp.json();
    if (data.code !== 200 && !silent) {
      updateOCRStatus('ok', '自动解析任务初始化失败: ' + (data.message || '未知错误'));
    }
  } catch (e) {
    if (!silent) updateOCRStatus('ok', '自动解析任务初始化失败: ' + e.message);
  } finally {
    _helperTaskEnsuring = false;
  }
}

function formatHelperRelativeTime(value) {
  if (!value) return '暂无心跳';
  const parsed = new Date(String(value).includes('T') ? String(value) : String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return String(value);
  const diffSec = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
  if (diffSec < 60) return diffSec + ' 秒前';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return diffMin + ' 分钟前';
  return String(value);
}

function isRecentHelperHeartbeat(value) {
  return isHelperSeenRecently(value, 18000);
}

function isHelperSeenRecently(value, maxAgeMs) {
  if (!value) return false;
  const parsed = new Date(String(value).includes('T') ? String(value) : String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return false;
  const ageMs = Date.now() - parsed.getTime();
  return ageMs >= -5000 && ageMs <= (maxAgeMs || 18000);
}

function renderHelperTaskPanel() {
  const statusEl = document.getElementById('helperConnectStatus');
  const setupEl = document.getElementById('helperSetupStatus');
  const listEl = document.getElementById('helperTaskList');
  const hintEl = document.getElementById('helperTaskHint');
  const projectId = getCurrentHelperProjectId();
  const bootstrapForProject = _helperLinkBootstrap && Number(_helperLinkBootstrap.projectId || 0) === Number(projectId || 0) ? _helperLinkBootstrap : null;
  const rawActive = (helperClientStatus && helperClientStatus.activeClient) || (bootstrapForProject && bootstrapForProject.activeClient) || null;
  const active = rawActive && ((helperClientStatus && helperClientStatus.connected) || rawActive.status === 'online' || isRecentHelperHeartbeat(rawActive.lastSeenAt)) ? rawActive : null;
  const currentTask = (Array.isArray(helperTaskList) && helperTaskList.find(item => Number(item.projectId || 0) === Number(projectId || 0)))
    || (helperTaskList.length ? helperTaskList[0] : null)
    || (bootstrapForProject ? bootstrapForProject.task : null);
  const helperStatusText = active ? '已连接' : '未连接';
  const helperStatusTone = active ? '#48c78e' : 'var(--text3)';
  const helperMetaText = active
    ? ((active.deviceName || '本地助手') + ' · 心跳 ' + formatHelperRelativeTime(active.lastSeenAt))
    : (bootstrapForProject && bootstrapForProject.activeClient
        ? ((bootstrapForProject.activeClient.deviceName || '本地助手') + ' · 已完成首次链接，正在同步任务状态')
        : (rawActive && rawActive.lastSeenAt ? ('上次心跳 ' + formatHelperRelativeTime(rawActive.lastSeenAt) + '，已判定离线') : '没有收到本地助手心跳'));
  const taskProjectText = currentTask ? (currentTask.projectId || projectId || '-') : (projectId || '-');
  const taskDeviceText = currentTask && currentTask.helperDeviceName ? currentTask.helperDeviceName : (active && active.deviceName ? active.deviceName : '-');
  const taskHelperStateText = helperStatusText;
  const helperHeartbeatText = active && active.lastSeenAt ? active.lastSeenAt : (rawActive && rawActive.lastSeenAt ? rawActive.lastSeenAt : '暂无');
  let taskStatusText = currentTask ? (currentTask.statusLabel || currentTask.status || '未开始') : '未创建';
  let taskTone = 'var(--text3)';
  if (currentTask && currentTask.status === 'running') {
    taskStatusText = '解析中';
    taskTone = '#48c78e';
  } else if (currentTask && currentTask.status === 'paused') {
    taskStatusText = '暂停中';
    taskTone = 'var(--orange)';
  } else if (currentTask && currentTask.status === 'error') {
    taskTone = 'var(--red)';
  } else if (currentTask) {
    taskTone = 'var(--accent)';
  }
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.style.display = 'none';
  }
  if (!listEl) return;
  if (hintEl) {
    hintEl.textContent = '';
    hintEl.style.display = 'none';
  }
  if (setupEl) {
    setupEl.innerHTML = `
      <div class="helper-status-grid">
        <div class="helper-conn-card">
          <div class="helper-card-top">
            <span class="helper-card-title">本地助手连接</span>
            <span class="helper-pill" style="color:${helperStatusTone};">${helperStatusText}</span>
          </div>
          <div class="helper-meta-grid">
            <div class="helper-meta-item"><div class="helper-meta-label">项目ID</div><div class="helper-meta-value">${escHtml(taskProjectText)}</div></div>
            <div class="helper-meta-item"><div class="helper-meta-label">助手</div><div class="helper-meta-value">${escHtml(taskHelperStateText)} · ${escHtml(taskDeviceText)}</div></div>
            <div class="helper-meta-item"><div class="helper-meta-label">最近心跳</div><div class="helper-meta-value">${escHtml(helperHeartbeatText)}</div></div>
            <div class="helper-meta-item"><div class="helper-meta-label">连接说明</div><div class="helper-meta-value">${escHtml(helperMetaText)}</div></div>
          </div>
        </div>
        <div class="helper-task-card">
          <div class="helper-card-top">
            <span class="helper-card-title">解析任务状态</span>
            <span class="helper-pill" style="color:${taskTone};">${escHtml(taskStatusText)}</span>
          </div>
          <div class="helper-meta-grid">
            <div class="helper-meta-item"><div class="helper-meta-label">当前目录</div><div class="helper-meta-value">${escHtml(currentTask && currentTask.folderPath ? currentTask.folderPath : '待选择同步目录')}</div></div>
          </div>
        </div>
      </div>
    `;
    setupEl.style.cssText = '';
  }
  if (!projectId) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:10px 12px;border:1px dashed var(--border);border-radius:8px;">当前未进入项目，暂不显示自动解析任务。</div>';
    return;
  }
  const renderTask = currentTask || {
    id: null,
    projectId,
    status: 'initializing',
    folderPath: '',
    stats: {},
    lastError: ''
  };
  listEl.innerHTML = [renderTask].map(task => {
    const stats = task.stats || {};
    const disabledAttr = task.id ? '' : ' disabled style="opacity:.45;cursor:not-allowed;"';
    return `<div class="helper-task-shell">
      <div class="helper-stats-grid">
        <div class="helper-stat"><div class="helper-stat-num">${stats.discovered || 0}</div><div class="helper-stat-label">发现</div></div>
        <div class="helper-stat"><div class="helper-stat-num">${stats.uploaded || 0}</div><div class="helper-stat-label">上传</div></div>
        <div class="helper-stat"><div class="helper-stat-num">${stats.parsed || 0}</div><div class="helper-stat-label">解析成功</div></div>
        <div class="helper-stat"><div class="helper-stat-num">${stats.failed || 0}</div><div class="helper-stat-label">失败</div></div>
        <div class="helper-stat"><div class="helper-stat-num">${stats.pending || 0}</div><div class="helper-stat-label">待处理</div></div>
      </div>
      <div class="helper-control-grid">
        <button class="btn btn-sm btn-secondary" onclick="selectHelperTaskFolder(${task.id || 0}, ${task.projectId || projectId || 0})"${disabledAttr}>选择同步目录</button>
        <button class="btn btn-sm btn-primary" onclick="startProjectAutoParse(${task.id || 0}, ${task.projectId || projectId || 0})"${disabledAttr}>开始同步解析</button>
        <button class="btn btn-sm btn-secondary" onclick="controlHelperTask(${task.id || 0}, 'pause')"${disabledAttr}>\u6682\u505c</button>
        <button class="btn btn-sm btn-danger" onclick="controlHelperTask(${task.id || 0}, 'stop')"${disabledAttr}>\u505c\u6b62</button>
      </div>
      ${task.lastError ? '<div style="margin-top:8px;font-size:11px;color:var(--red);">' + escHtml(task.lastError) + '</div>' : ''}
    </div>`;
  }).join('');
}

async function startProjectAutoParse(id, projectId) {
  if (!id) return;
  maybeWakeLocalHelper(projectId || getCurrentHelperProjectId());
  await controlHelperTask(id, 'start', true);
}

function selectHelperTaskFolder(taskId, projectId) {
  const task = helperTaskList.find(item => Number(item.id) === Number(taskId));
  const active = helperClientStatus && helperClientStatus.activeClient;
  const hasKnownClient = !!(helperClientStatus && Array.isArray(helperClientStatus.clients) && helperClientStatus.clients.length);
  if (!active && !hasKnownClient) {
    generateHelperLinkToken();
    return;
  }
  openLocalHelperProtocol('bind-folder', {
    taskId,
    projectId: projectId || task?.projectId || getCurrentHelperProjectId() || '',
    taskName: task?.name || ''
  }, '正在打开本地助手，为当前项目选择同步目录');
  setTimeout(() => refreshHelperTasks(true), 2000);
}

async function generateHelperLinkToken() {
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) { showToast('请先登录', 'warn'); return; }
  try {
    const resp = await fetch(getLocalHelperApiBase() + '/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({})
    });
    const data = await resp.json();
    if (data.code === 200 && data.data && data.data.linkToken) {
      showHelperLinkDialog(data.data.linkToken);
    } else {
      showToast('生成连接码失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('生成连接码失败: ' + e.message, 'error');
  }
}

async function preGenerateHelperLinkCode() {
  if (_preGeneratedLinkCode && (Date.now() - _preGeneratedLinkCodeAt) < LINK_CODE_PREGEN_TTL) {
    return _preGeneratedLinkCode;  // 缓存有效，直接返回
  }
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) return '';
  try {
    const resp = await fetch(getLocalHelperApiBase() + '/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({})
    });
    const data = await resp.json();
    if (data.code === 200 && data.data && data.data.linkToken) {
      _preGeneratedLinkCode = data.data.linkToken;
      _preGeneratedLinkCodeAt = Date.now();
      return _preGeneratedLinkCode;
    }
  } catch (e) {
    // 静默失败，点击时再实时生成
  }
  return '';
}

async function controlHelperTask(id, action, silentWake) {
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) { showToast('请先登录', 'warn'); return; }
  const actionLabels = { start: '开始解析', pause: '暂停', stop: '停止' };
  if (action === 'start' && !silentWake) {
    const currentTask = helperTaskList.find(item => Number(item.id) === Number(id));
    maybeWakeLocalHelper(currentTask?.projectId || getCurrentHelperProjectId());
  }
  try {
    const resp = await fetch(getLocalHelperApiBase() + '/tasks/' + id + '/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action })
    });
    const data = await resp.json();
    if (data.code === 200) {
      showToast((actionLabels[action] || action) + ' 已执行', 'success');
      refreshHelperTasks();
    } else {
      showToast('操作失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

function closeHelperLinkDialog() {
  const mask = document.getElementById('helperLinkDialog');
  if (mask) mask.remove();
}

async function copyHelperLinkCode() {
  const input = document.getElementById('helperLinkCodeInput');
  if (!input) return false;
  const code = input.value || '';
  let copied = false;
  try {
    await navigator.clipboard.writeText(code);
    copied = true;
  } catch (e) {
    input.focus();
    input.select();
    try {
      copied = document.execCommand('copy');
    } catch (err) {
      copied = false;
    }
  }
  if (copied) {
    showToast('\u5df2\u590d\u5236\u8fde\u63a5\u7801', 'success');
  } else {
    input.focus();
    input.select();
    showToast('\u81ea\u52a8\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236\u8f93\u5165\u6846\u4e2d\u7684\u8fde\u63a5\u7801', 'warn');
  }
  return copied;
}

function downloadLocalHelperPackage() {
  const link = document.createElement('a');
  link.href = LOCAL_HELPER_DOWNLOAD_URL;
  link.download = 'zhenwu-local-helper-setup.exe';
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('已开始下载本地助手安装包，请下载完成后双击安装', 'success');
}

async function connectLocalHelperWithMode(mode, existingCode) {
  const token = typeof getToken === 'function' ? getToken() : '';
  if (!token) { showToast('请先登录', 'warn'); return; }
  const modeLabel = mode === 'refresh' ? '刷新链接助手' : '首次链接助手';
  const readyCode = String(existingCode || '').trim();

  // 立即显示弹窗，确保用户点击后第一时间看到反馈
  showHelperActionModal(modeLabel + '中', true);

  if (readyCode) {
    // 有预置码：openLocalHelperWithCode 在 linkLocalHelperWithFeedback 内同步执行，
    // 在遇到第一个 await 之前完成 location.href 赋值，保留用户手势
    await linkLocalHelperWithFeedback(readyCode, modeLabel);
    return;
  }
  // 无预置码：尝试使用后台预生成的链接码（首次链接场景），同步读取避免 await
  const preCode = (mode === 'first' && _preGeneratedLinkCode && (Date.now() - _preGeneratedLinkCodeAt) < LINK_CODE_PREGEN_TTL) ? _preGeneratedLinkCode : '';
  if (preCode) {
    // 消耗后立即清除，防止复用
    _preGeneratedLinkCode = '';
    _preGeneratedLinkCodeAt = 0;
    await linkLocalHelperWithFeedback(preCode, modeLabel);
    return;
  }
  // 兜底：实时生成链接码并打开本地助手
  updateHelperActionModalTitle('正在生成连接码…', '请稍等');
  try {
    const resp = await fetch(getLocalHelperApiBase() + '/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({})
    });
    const data = await resp.json();
    if (data.code === 200 && data.data && data.data.linkToken) {
      // 实时生成链接码并触发本地助手（此时用户手势可能已丢失，但 <a>.click() 仍会尽力触发）
      await linkLocalHelperWithFeedback(data.data.linkToken, modeLabel);
    } else {
      closeHelperActionModal();
      showToast(modeLabel + '失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (e) {
    closeHelperActionModal();
    showToast(modeLabel + '失败: ' + e.message, 'error');
  }
}

async function linkLocalHelperWithFeedback(code, modeLabel) {
  // 弹窗已由调用方提前显示，这里直接更新状态
  const linkCode = String(code || '').trim();
  if (!linkCode) {
    showHelperActionModal('连接码异常，请重试', false);
    return;
  }
  openLocalHelperWithCode(linkCode);
  updateHelperActionModalTitle('步骤 1/4：已发送连接请求', '等待本地助手响应…');

  try {
    // 20 秒轮询链接码消费状态
    const linkState = await waitForLinkTokenConsumed(linkCode, 20000);
    if (!linkState || !linkState.used) {
      updateHelperActionModalTitle('步骤 2/4：未收到响应', '尝试检测在线状态…');
    }
    const connected = !!(linkState && linkState.used) || await waitForHelperConnected(5000);
    if (connected) {
      updateHelperActionModalTitle('步骤 3/4：已连接', '正在同步数据…');
      if (linkState && linkState.used) {
        applyHelperLinkBootstrap(linkState);
        renderHelperTaskPanel();
        renderOCRQueue();
      }
      try {
        await hydrateHelperStateAfterLink(getCurrentHelperProjectId());
        setTimeout(() => refreshHelperTasks(true), 1500);
      } catch (e) {
        console.warn('[LocalHelper] 链接成功后刷新状态失败:', e.message || e);
      }
      closeHelperLinkDialog();
      showHelperActionModal('已完成链接', false);
    } else {
      showHelperActionModal('还没有完成链接，请确认本地助手已安装后再试一次', false);
    }
  } catch (e) {
    console.error('[LocalHelper] 链接流程异常:', e.message || e);
    showHelperActionModal('链接流程出错: ' + (e.message || '未知错误'), false);
  }
}

function openLocalHelperWithCode(code, successText) {
  const linkCode = String(code || '').trim();
  if (!linkCode) {
    showToast('连接码为空，无法连接本地助手', 'warn');
    return;
  }
  const helperApiBase = getLocalHelperApiBase().replace(/\/local-helper$/, '');
  openLocalHelperProtocol('link', { code: linkCode, apiBase: helperApiBase, projectId: getCurrentHelperProjectId() || '' }, successText || '正在尝试连接本地助手');
}

function showHelperLinkDialog(code) {
  closeHelperLinkDialog();
  const linkCode = String(code || '').trim();
  const mask = document.createElement('div');
  mask.id = 'helperLinkDialog';
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(3px);z-index:10020;display:flex;align-items:center;justify-content:center;padding:16px;';
  mask.innerHTML = `
    <div style="width:min(520px,100%);background:var(--bg1);border:1px solid rgba(240,180,41,.25);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.25);padding:18px 18px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text1);">连接本地助手</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px;">下载只保存安装包；安装完成后，可首次链接或刷新链接助手。</div>
        </div>
        <button type="button" onclick="closeHelperLinkDialog()" style="border:none;background:transparent;color:var(--text3);font-size:20px;line-height:1;cursor:pointer;padding:0 4px;">×</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-secondary" onclick="downloadLocalHelperPackage()">下载本地助手</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="connectLocalHelperWithMode('first','${escHtml(linkCode)}')">首次链接助手</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="connectLocalHelperWithMode('refresh','${escHtml(linkCode)}')">刷新链接助手</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.7;">
        ${linkCode ? '连接码已准备好；点击“首次链接助手”或“刷新链接助手”会自动关联本地助手。' : '点击“首次链接助手”或“刷新链接助手”时，系统会自动生成连接码并关联本地助手。'}
      </div>
    </div>
  `;
  mask.addEventListener('click', e => {
    if (e.target === mask) closeHelperLinkDialog();
  });
  document.body.appendChild(mask);
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
  const helperTask = helperTaskList.length ? helperTaskList[0] : null;
  const helperPendingFiles = Array.isArray(helperTask?.stats?.pendingFiles)
    ? helperTask.stats.pendingFiles.filter(name => String(name || '').trim())
    : [];
  const helperCurrentFile = String(helperTask?.stats?.currentFile || '').trim();
  const helperQueueItems = [];
  if (helperTask && getCurrentHelperProjectId()) {
    if (helperCurrentFile) {
      helperQueueItems.push({
        name: helperCurrentFile,
        status: helperTask.status === 'error' ? 'error' : 'processing',
        error: helperTask.status === 'error' ? (helperTask.lastError || '处理失败') : '',
        source: 'auto'
      });
    }
    helperPendingFiles.forEach(name => {
      if (name !== helperCurrentFile) {
        helperQueueItems.push({ name, status: 'pending', error: '', source: 'auto' });
      }
    });
  }
  if (queueCount) queueCount.textContent = visibleItems.length + helperQueueItems.length;
  if (queueArea) queueArea.style.display = 'block';

  if (queueList) {
    if (visibleItems.length === 0 && helperQueueItems.length === 0) {
      queueList.innerHTML = '<div style="text-align:center;padding:16px 12px;color:var(--text3);font-size:12px;">暂无解析任务，手动批量上传或战报自动解析产生的内容都会显示在这里</div>';
    } else {
      const helperHtml = helperQueueItems.map(item => {
        const statusClass = item.status === 'pending' ? 'qi-pending'
          : item.status === 'processing' ? 'qi-processing'
          : 'qi-error';
        const statusIcon = item.status === 'pending' ? '⏳'
          : item.status === 'processing' ? '⚙️'
          : '❌';
        const statusText = item.status === 'pending' ? '等待开始同步解析'
          : item.status === 'processing' ? '自动解析处理中...'
          : (item.error || '自动解析失败');
        return `<div class="queue-item">
          <span class="qi-icon">${statusIcon}</span>
          <span class="qi-name">${escHtml(item.name)}</span>
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
      // 鍙湁 pending / error 鐘舵€佸厑璁稿垹闄わ紝鎸夐挳鏀惧湪鐘舵€佸彸渚?
      const canDelete = item.status === 'pending' || item.status === 'error';
      const delBtn = canDelete
        ? `<span class="qi-del" title="删除" onclick="removeQueueItem(${idx})">✕</span>`
        : '';
      return `<div class="queue-item">
        <span class="qi-icon">${statusIcon}</span>
        <span class="qi-name">[手动批量上传] ${escHtml(item.name)}</span>
        <span class="${statusClass}">${statusText}</span>
        ${delBtn}
      </div>`;
    }).join('');
      queueList.innerHTML = helperHtml + manualHtml;
    }
  }
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

function clearQueue() {
  const curPid = normalizeQueueProjectId(window.currentProjectId);
  // 鍙竻闄ゅ綋鍓嶉」鐩殑闈炲鐞嗕腑浠诲姟锛屼繚鐣欏叾浠栭」鐩殑鍜屾鍦ㄥ鐞嗙殑
  ocrQueue = ocrQueue.filter(q => q.status === 'processing' || normalizeQueueProjectId(q.projectId) !== curPid);
  renderOCRQueue();  // 鍐呴儴澶勭悊 queueArea 鏄鹃殣
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
      requestAnimationFrame(() => {
        _renderPending = false;
        _lastRenderTime = Date.now();
        _doRenderAll();
      });
    }
    return;
  }
  _lastRenderTime = now;
  _doRenderAll();
}

function _doRenderAll() {
  try { if (typeof loadAllRecords === 'function') loadAllRecords(); } catch(e) { console.error('loadAllRecords:', e); }
  try { if (typeof renderDataTable === 'function') renderDataTable(); } catch(e) { console.error('renderDataTable:', e); }
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

// ========== 鎵归噺澶勭悊 ==========
async function startBatchProcess() {
  if (ocrRunning) return;

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

      item.status = 'processing';
      if (item._retries === undefined) item._retries = 0;
      processing++;
      renderOCRQueue();

      let base64 = null;
      let success = false;

      // 鈹€鈹€ 閲嶈瘯寰幆锛氱灛鏃堕敊璇嚜鍔ㄦ仮澶嶏紝涓嶉樆鏂暣鎵?鈹€鈹€
      while (!success) {
        try {
          base64 = await readFileAsBase64(item.file);
          const abortSig = batchAbortController ? batchAbortController.signal : null;
          const token = typeof getToken === 'function' ? getToken() : '';

          updateOCRStatus('work', 'OCR 识别中...');
          // 鐢ㄩ槦鍒楅」璁板綍鐨?projectId锛岄伩鍏嶇敤鎴蜂腑閫斿垏鎹㈤」鐩奖鍝嶅綊灞?
          const itemProjectId = item.projectId || null;
          const labelCfg = await getLabelConfig(itemProjectId);
          const reqBody = {
            image: base64,
            projectId: itemProjectId,
            imageName: item.name,
          };
          if (labelCfg) reqBody.labelConfig = labelCfg;

          // 鍗曟璇锋眰瓒呮椂鎺у埗锛氬悗鍙版爣绛鹃〉 fetch 鍙兘姘镐笉 resolve锛屽己鍒惰秴鏃朵腑鏂噸璇?
          const fetchTimeoutMs = OCR_CONFIG.timeout || 120000;
          const timeoutCtrl = new AbortController();
          const timeoutId = setTimeout(() => timeoutCtrl.abort(new Error('OCR 请求超时')), fetchTimeoutMs);
          const fetchSignal = abortSig ? AbortSignal.any([timeoutCtrl.signal, abortSig]) : timeoutCtrl.signal;

          let resp;
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

          // 鉁?璇嗗埆鎴愬姛
          const record = result.data;
          // 缂撳瓨鍒版湰鍦?IndexedDB锛堟湇鍔＄宸插瓨鍏?MySQL锛屼笉閲嶅鍚屾浜戠锛?
          if (typeof dbAddLocal === 'function') {
            const localId = await dbAddLocal(record);
            if (typeof addSysLog === 'function') {
              addSysLog('action', '涓婁紶鎴樻姤: ' + (record.leftPlayer || record.attackerName || item.name) + (window.currentProjectId ? ' [椤圭洰ID:' + window.currentProjectId + ']' : ''));
            }
            if (window.currentProjectId && typeof addBattleToProject === 'function' && localId) {
              await addBattleToProject(window.currentProjectId, localId);
            }
          }
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
  if (!ocrPaused) {
    // 鈥斺€旀殏鍋滐細绔嬪嵆涓姝ｅ湪杩涜鐨?OCR 璇锋眰鈥斺€?
    ocrPaused = true;
    ocrPausedByUser = true;
    if (batchAbortController) batchAbortController.abort();
    if (btn) btn.textContent = '▶ 继续';
  } else {
    // 鈥斺€旂户缁細閲嶆柊鍚姩鎵瑰鐞嗭紙宸插鐞嗗畬鐨勯」淇濇寔 done锛屼粠绗竴涓?pending 缁х画锛夆€斺€?
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




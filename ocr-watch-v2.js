/**
 * 战报自动监听 v2.1 - 统一队列渲染
 */

window.ocrWatchTask = null;
window.autoCompletedFiles = [];  // 记录最近完成的自动解析文件
let ocrWatchTimer = null;

function ocrWatchApiBase() { return 'http://localhost:3000/api'; }

// ======= 替换旧面板 =======
function replaceOcrWatchPanel() {
  console.log('[OCR-Watch] replaceOcrWatchPanel 被调用');
  // 已替换过，跳过（防止无限 setTimeout 链）
  if (document.getElementById('ocrWatchStatus')) {
    console.log('[OCR-Watch] 面板已存在，跳过替换');
    return;
  }
  const oldPanel = document.getElementById('helperTaskPanel');
  if (!oldPanel) {
    console.log('[OCR-Watch] 等待 helperTaskPanel 元素...');
    return setTimeout(replaceOcrWatchPanel, 500);
  }

  console.log('[OCR-Watch] 开始替换面板');

  const parent = oldPanel.parentNode;
  oldPanel.remove();

  const newHtml = `
  <div style="padding:8px 0;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <span style="font-size:14px;font-weight:700;color:var(--accent);">⚡ 战报自动监听</span>
      <span style="font-size:11px;color:var(--text3);">每个项目独立 · 自动处理 · 统一在战报解析列表中显示</span>
    </div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px;">监听目录</div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="ocrWatchFolder" placeholder="待设置目录"
            style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text);">
          <button id="btnSelectOcrWatchFolder" class="btn btn-sm btn-secondary">选择</button>
        </div>
      </div>
      <div style="min-width:100px;text-align:center;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px;">状态</div>
        <div style="font-size:13px;font-weight:700;color:var(--text3);" id="ocrWatchStatus">加载中...</div>
      </div>
      <div style="min-width:80px;text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--text);" id="ocrWatchPending">0</div>
        <div style="font-size:11px;color:var(--text3);">待处理</div>
      </div>
      <div style="min-width:80px;text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--text);" id="ocrWatchProcessed">0</div>
        <div style="font-size:11px;color:var(--text3);">已处理</div>
      </div>
      <div style="min-width:110px;">
        <button class="btn btn-sm btn-primary" id="btnOcrWatchToggle" style="width:100%;justify-content:center;">▶ 开始监听</button>
      </div>
    </div>
    <div style="font-size:11px;color:var(--red);margin-top:6px;" id="ocrWatchError"></div>
  </div>`;

  parent.insertAdjacentHTML('afterbegin', newHtml);

  // 绑定按钮事件（使用 setTimeout 确保 DOM 已渲染）
  setTimeout(() => {
    var btnSelect = document.getElementById('btnSelectOcrWatchFolder');
    if (btnSelect) {
      btnSelect.addEventListener('click', selectOcrWatchFolder);
      console.log('[OCR-Watch] 选择文件夹按钮已绑定事件');
    } else {
      console.warn('[OCR-Watch] btnSelectOcrWatchFolder 未找到');
    }

    var btnToggle = document.getElementById('btnOcrWatchToggle');
    if (btnToggle) {
      // 移除可能存在的旧事件监听器
      btnToggle.replaceWith(btnToggle.cloneNode(true));
      btnToggle = document.getElementById('btnOcrWatchToggle');

      btnToggle.addEventListener('click', function(e) {
        console.log('[OCR-Watch] 按钮点击事件触发');
        toggleOcrWatchTask();
      });
      console.log('[OCR-Watch] 开始/暂停按钮已绑定事件');
    } else {
      console.warn('[OCR-Watch] btnOcrWatchToggle 未找到');
    }
  }, 0);

  initOcrWatch();
  console.log('[OCR-Watch] 面板已加载 v202607071650');
}

// ======= 数据加载 =======
async function loadOcrWatchTask(projectId) {
  if (!projectId) return;
  const token = localStorage.getItem('nslg_token');
  if (!token) return;

  try {
    const resp = await fetch(ocrWatchApiBase() + '/ocr-watch/tasks?projectId=' + encodeURIComponent(projectId), {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();
    if (data.code === 200) {
      console.log('[OCR-Watch] 加载任务: status=' + (data.data ? data.data.status : 'null') + ' heartbeat=' + (data.data ? data.data.lastHeartbeat : 'null') + ' processedCount=' + (data.data ? data.data.processedCount : 'null'));
      var prev = window.ocrWatchTask;
      window.ocrWatchTask = data.data;
      updateOcrWatchUI();

      // 当已处理数量变化时，记录完成的文件并刷新数据底表
      var newCount = data.data ? data.data.processedCount : 0;
      var oldCount = prev ? prev.processedCount : 0;
      if (newCount !== oldCount && newCount > oldCount) {
        // 新完成了文件：将 currentFile 加入已完成列表
        var completedFile = prev ? prev.currentFile : null;
        if (completedFile && String(completedFile).trim()) {
          var now = new Date();
          var timeStr = String(now.getHours()).padStart(2, '0') + ':'
                      + String(now.getMinutes()).padStart(2, '0') + ':'
                      + String(now.getSeconds()).padStart(2, '0');
          window.autoCompletedFiles.unshift({ name: completedFile, time: timeStr });
          // 只保留最近10条
          if (window.autoCompletedFiles.length > 10) {
            window.autoCompletedFiles = window.autoCompletedFiles.slice(0, 10);
          }
        }
        // 立即从云端同步新数据并刷新数据底表
        console.log('[OCR-Watch] 检测到新完成文件，processedCount: ' + oldCount + ' → ' + newCount);

        // 从 MySQL 拉取最新的战报记录
        if (window.cloudSync && typeof window.cloudSync.getRecords === 'function') {
          try {
            console.log('[OCR-Watch] 从云端拉取最新记录...');
            const cloudRecords = await window.cloudSync.getRecords(window.currentProjectId);
            console.log('[OCR-Watch] 云端返回', cloudRecords.length, '条记录');

            // 找出本地 IndexedDB 没有的新记录（通过 cloudId 比对）
            if (typeof dbGetAll === 'function' && typeof dbAddLocal === 'function') {
              const localRecords = await dbGetAll();
              const localCloudIds = new Set(localRecords.map(r => r.cloudId).filter(Boolean));

              for (const cloudRec of cloudRecords) {
                if (!localCloudIds.has(cloudRec.id)) {
                  // 新记录：保存到 IndexedDB
                  const rec = {
                    cloudId: cloudRec.id,
                    projectId: cloudRec.projectId || cloudRec.project_id,
                    leftPlayer: cloudRec.attackerName || cloudRec.attacker_name || '',
                    rightPlayer: cloudRec.enemyName || cloudRec.enemy_name || '',
                    result: cloudRec.result || '',
                    battleDate: cloudRec.battleDate || cloudRec.battle_date || '',
                    leftAlliance: cloudRec.leftAlliance || cloudRec.left_alliance || '',
                    rightAlliance: cloudRec.rightAlliance || cloudRec.right_alliance || '',
                    leftFormation: cloudRec.leftFormation || cloudRec.left_formation || '',
                    rightFormation: cloudRec.rightFormation || cloudRec.right_formation || '',
                    leftGeneral1: cloudRec.leftGeneral1 || cloudRec.left_general_1 || '',
                    leftGeneral2: cloudRec.leftGeneral2 || cloudRec.left_general_2 || '',
                    leftGeneral3: cloudRec.leftGeneral3 || cloudRec.left_general_3 || '',
                    rightGeneral1: cloudRec.rightGeneral1 || cloudRec.right_general_1 || '',
                    rightGeneral2: cloudRec.rightGeneral2 || cloudRec.right_general_2 || '',
                    rightGeneral3: cloudRec.rightGeneral3 || cloudRec.right_general_3 || '',
                    leftGeneral1Stars: cloudRec.leftGeneral1Stars || cloudRec.left_general_1_stars || 0,
                    leftGeneral2Stars: cloudRec.leftGeneral2Stars || cloudRec.left_general_2_stars || 0,
                    leftGeneral3Stars: cloudRec.leftGeneral3Stars || cloudRec.left_general_3_stars || 0,
                    rightGeneral1Stars: cloudRec.rightGeneral1Stars || cloudRec.right_general_1_stars || 0,
                    rightGeneral2Stars: cloudRec.rightGeneral2Stars || cloudRec.right_general_2_stars || 0,
                    rightGeneral3Stars: cloudRec.rightGeneral3Stars || cloudRec.right_general_3_stars || 0,
                    leftTactic1_1: cloudRec.leftTactic1_1 || cloudRec.left_tactic_1_1 || '',
                    leftTactic1_2: cloudRec.leftTactic1_2 || cloudRec.left_tactic_1_2 || '',
                    leftTactic1_3: cloudRec.leftTactic1_3 || cloudRec.left_tactic_1_3 || '',
                    leftTactic2_1: cloudRec.leftTactic2_1 || cloudRec.left_tactic_2_1 || '',
                    leftTactic2_2: cloudRec.leftTactic2_2 || cloudRec.left_tactic_2_2 || '',
                    leftTactic2_3: cloudRec.leftTactic2_3 || cloudRec.left_tactic_2_3 || '',
                    leftTactic3_1: cloudRec.leftTactic3_1 || cloudRec.left_tactic_3_1 || '',
                    leftTactic3_2: cloudRec.leftTactic3_2 || cloudRec.left_tactic_3_2 || '',
                    leftTactic3_3: cloudRec.leftTactic3_3 || cloudRec.left_tactic_3_3 || '',
                    rightTactic1_1: cloudRec.rightTactic1_1 || cloudRec.right_tactic_1_1 || '',
                    rightTactic1_2: cloudRec.rightTactic1_2 || cloudRec.right_tactic_1_2 || '',
                    rightTactic1_3: cloudRec.rightTactic1_3 || cloudRec.right_tactic_1_3 || '',
                    rightTactic2_1: cloudRec.rightTactic2_1 || cloudRec.right_tactic_2_1 || '',
                    rightTactic2_2: cloudRec.rightTactic2_2 || cloudRec.right_tactic_2_2 || '',
                    rightTactic2_3: cloudRec.rightTactic2_3 || cloudRec.right_tactic_2_3 || '',
                    rightTactic3_1: cloudRec.rightTactic3_1 || cloudRec.right_tactic_3_1 || '',
                    rightTactic3_2: cloudRec.rightTactic3_2 || cloudRec.right_tactic_3_2 || '',
                    rightTactic3_3: cloudRec.rightTactic3_3 || cloudRec.right_tactic_3_3 || '',
                    leftLoss: cloudRec.leftLoss || cloudRec.left_loss,
                    rightLoss: cloudRec.rightLoss || cloudRec.right_loss,
                    leftTotal: cloudRec.leftTotal || cloudRec.left_total,
                    rightTotal: cloudRec.rightTotal || cloudRec.right_total,
                    leftLossRate: cloudRec.leftLossRate || cloudRec.left_loss_rate,
                    rightLossRate: cloudRec.rightLossRate || cloudRec.right_loss_rate,
                    time: cloudRec.created_at || new Date().toLocaleString('zh-CN'),
                    _cloudSynced: true
                  };

                  console.log('[OCR-Watch] 发现新记录，cloudId:', cloudRec.id, '准备保存到 IndexedDB');
                  await dbAddLocal(rec);
                  console.log('[OCR-Watch] 新记录已保存到 IndexedDB');
                }
              }
            }
          } catch (e) {
            console.error('[OCR-Watch] 同步云端数据失败:', e);
          }
        }

        if (typeof renderDataTable === 'function') {
          try { renderDataTable(); } catch(e) {}
        }
      }
      // notify queue list to refresh - reload pending tasks from backend
      if (typeof loadPendingTasksFromBackend === 'function') {
        try { await loadPendingTasksFromBackend(); } catch(e) {}
      }
      if (typeof renderOCRQueue === 'function') renderOCRQueue();
    }
  } catch (e) {
    console.error('[OCR-Watch] 加载任务失败:', e.message);
  }
}

// ======= 更新UI =======
function updateOcrWatchUI() {
  try {
  const task = window.ocrWatchTask;
  if (!task) {
    var statusEl = document.getElementById('ocrWatchStatus');
    if (statusEl) statusEl.textContent = '未配置';
    return;
  }

  // 心跳检测：判断本地助手是否真正在工作
  var heartbeatMs = 0;
  if (task.lastHeartbeat) {
    var parsed = new Date(task.lastHeartbeat).getTime();
    if (!isNaN(parsed)) {
      heartbeatMs = Date.now() - parsed;
    } else {
      console.warn('[OCR-Watch] 无法解析 lastHeartbeat:', task.lastHeartbeat, typeof task.lastHeartbeat);
    }
  }
  var heartbeatAge = heartbeatMs;
  var effectiveStatus = task.status;

  // 如果状态是 running 或 paused，但心跳为空或超时，视为 idle
  if (task.status === 'running' || task.status === 'paused') {
    if (!task.lastHeartbeat || heartbeatAge > 120000) {
      effectiveStatus = 'idle';
    }
  }

  console.log('[OCR-Watch] UI update: rawStatus=' + task.status + ' effective=' + effectiveStatus + ' heartbeat=' + (task.lastHeartbeat || 'null') + ' heartbeatAge=' + heartbeatAge + 'ms taskKeys=' + Object.keys(task).join(','));

  // 状态：区分"真正空闲"和"心跳超时离线"
  var statusMap = { running: '✅ 运行中', paused: '⏸️ 已暂停', idle: '💤 空闲', error: '❌ 错误' };
  var statusEl2 = document.getElementById('ocrWatchStatus');
  if (effectiveStatus === 'idle' && task.status !== 'idle' && heartbeatAge > 120000) {
    // 心跳超过 2 分钟：助手已离线
    if (statusEl2) statusEl2.textContent = '⚠️ 离线';
  } else {
    if (statusEl2) statusEl2.textContent = statusMap[effectiveStatus] || task.status;
  }

  // 目录
  var folderEl = document.getElementById('ocrWatchFolder');
  if (folderEl && task.folderPath) folderEl.value = task.folderPath;

  // 数量
  var pendingEl = document.getElementById('ocrWatchPending');
  if (pendingEl) pendingEl.textContent = task.pendingCount || 0;
  var processedEl = document.getElementById('ocrWatchProcessed');
  if (processedEl) processedEl.textContent = task.processedCount || 0;

  // 切换按钮
  var btnToggle = document.getElementById('btnOcrWatchToggle');
  var hasFolder = task.folderPath && task.folderPath.trim();

  // 心跳过期导致的 idle：允许用户"开始"来重新激活
  var isStaleIdle = (effectiveStatus === 'idle' && task.status !== 'idle');

  if (btnToggle) {
    if (effectiveStatus === 'running') {
      btnToggle.disabled = false;
      btnToggle.textContent = '⏸ 暂停监听';
      btnToggle.className = 'btn btn-sm btn-secondary';
    } else if (effectiveStatus === 'paused') {
      btnToggle.disabled = false;
      btnToggle.textContent = '▶ 继续监听';
      btnToggle.className = 'btn btn-sm btn-primary';
    } else if (isStaleIdle || effectiveStatus === 'idle') {
      btnToggle.disabled = !hasFolder;
      btnToggle.textContent = '▶ 开始监听';
      btnToggle.className = 'btn btn-sm btn-primary';
    }
  }

  // 错误
  var errEl = document.getElementById('ocrWatchError');
  if (errEl) errEl.textContent = task.lastError || '';
  } catch(e) {
    console.error('[OCR-Watch] updateOcrWatchUI 异常:', e.message, e.stack);
  }
}

// ======= 操作 =======
async function saveOcrWatchFolder(folderPath) {
  var pid = window.currentProjectId;
  if (!pid) return;
  var token = localStorage.getItem('nslg_token');
  try {
    var resp = await fetch(ocrWatchApiBase() + '/ocr-watch/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ projectId: Number(pid), folderPath: folderPath })
    });
    var data = await resp.json();
    if (data.code === 200) await loadOcrWatchTask(pid); else alert(data.message);
  } catch (e) { alert('失败: ' + e.message); }
}

async function ocrWatchControl(action) {
  console.log('[OCR-Watch] control action:', action, 'task:', window.ocrWatchTask ? window.ocrWatchTask.id : 'null');
  if (!window.ocrWatchTask) { console.warn('[OCR-Watch] 无任务，无法执行', action); return; }
  var token = localStorage.getItem('nslg_token');
  try {
    var resp = await fetch(ocrWatchApiBase() + '/ocr-watch/tasks/' + window.ocrWatchTask.id + '/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: action })
    });
    var data = await resp.json();
    console.log('[OCR-Watch] control response:', data.code, data.message || '');
    if (data.code === 200) loadOcrWatchTask(window.ocrWatchTask.projectId); else alert(data.message);
  } catch (e) { console.error('[OCR-Watch] control error:', e.message); alert('失败: ' + e.message); }
}

async function selectOcrWatchFolder() {
  var token = localStorage.getItem('nslg_token');
  if (!token) { alert('未登录或登录已过期，请重新登录'); return; }
  var pid = window.currentProjectId;
  if (!pid) { alert('请先选择项目'); return; }
  try {
    var resp = await fetch(ocrWatchApiBase() + '/ocr-watch/select-folder?projectId=' + encodeURIComponent(pid), {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await resp.json();
    if (data.code === 200 && data.data && data.data.path) {
      var input = document.getElementById('ocrWatchFolder');
      if (input) input.value = data.data.path;
      await saveOcrWatchFolder(data.data.path);
    }
  } catch (e) {
    alert('打开文件夹选择失败: ' + e.message);
  }
}
async function startOcrWatchTask() {
  // 如果任务未加载，先加载再操作
  if (!window.ocrWatchTask && window.currentProjectId) {
    await loadOcrWatchTask(window.currentProjectId);
  }
  if (!window.ocrWatchTask) { console.warn('[OCR-Watch] start: 无任务'); return; }
  ocrWatchControl('start');
}
async function pauseOcrWatchTask() {
  if (!window.ocrWatchTask) { console.warn('[OCR-Watch] pause: 无任务'); return; }
  ocrWatchControl('pause');
}
async function stopOcrWatchTask() {
  if (!window.ocrWatchTask) { console.warn('[OCR-Watch] stop: 无任务'); return; }
  ocrWatchControl('stop');
}

// 切换开始/暂停
async function toggleOcrWatchTask() {
  console.log('[OCR-Watch] toggle 函数被调用');
  // 如果任务未加载，先加载再操作
  if (!window.ocrWatchTask && window.currentProjectId) {
    await loadOcrWatchTask(window.currentProjectId);
  }
  if (!window.ocrWatchTask) {
    console.warn('[OCR-Watch] toggle: 无任务');
    return;
  }

  const task = window.ocrWatchTask;
  const effectiveStatus = task.status;

  // 检查 heartbeat：如果状态是 running 但心跳为空，说明本地助手实际未工作
  const heartbeatAge = task.lastHeartbeat ? Date.now() - new Date(task.lastHeartbeat).getTime() : 999999;
  const isActuallyRunning = effectiveStatus === 'running' && heartbeatAge < 30000;

  console.log('[OCR-Watch] toggle: status=' + effectiveStatus + ' heartbeat=' + task.lastHeartbeat + ' age=' + heartbeatAge + ' isActuallyRunning=' + isActuallyRunning);

  // 根据当前状态决定操作
  if (isActuallyRunning) {
    // 真正在运行，点击则暂停
    ocrWatchControl('pause');
  } else {
    // 需要启动（paused/idle 或者 running 但无心跳）
    // 开始监听前，先确保本地助手已连接
    const connected = await ensureLocalHelperConnected();
    if (!connected) {
      console.warn('[OCR-Watch] 本地助手未连接，无法开始监听');
      return;
    }
    ocrWatchControl('start');
  }
}

// ======= 初始化 =======
function initOcrWatch() {
  if (ocrWatchTimer) clearInterval(ocrWatchTimer);
  var pid = window.currentProjectId;
  if (pid) loadOcrWatchTask(pid);
  // 改进2：轮询间隔从5秒降到3秒，提升实时性
  ocrWatchTimer = setInterval(function() {
    if (window.currentProjectId) loadOcrWatchTask(window.currentProjectId);
  }, 3000);
}

// 页面加载后自动替换旧面板
replaceOcrWatchPanel();

// ========== 本地助手自动连接 ==========
const HELPER_API = 'http://127.0.0.1:9999';
let helperConnected = false;

// 检测本地助手是否运行
async function checkLocalHelper() {
  console.log('[Helper] 开始检测本地助手...');
  try {
    const resp = await fetch(HELPER_API + '/ping', {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    const data = await resp.json();
    helperConnected = resp.ok && data.status === 'ok';
    console.log('[Helper] 检测结果: running=' + helperConnected + ' configured=' + data.configured);
    return { running: helperConnected, configured: data.configured };
  } catch (e) {
    console.log('[Helper] 检测失败:', e.message);
    helperConnected = false;
    return { running: false, configured: false };
  }
}

// 激活本地助手
async function activateLocalHelper() {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    if (!token) {
      console.warn('[Helper] 无法获取用户 Token');
      return false;
    }

    const resp = await fetch(HELPER_API + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        apiBase: ocrWatchApiBase()
      }),
      signal: AbortSignal.timeout(5000)
    });

    const data = await resp.json();
    if (resp.ok && data.status === 'ok') {
      console.log('[Helper] 激活成功');
      helperConnected = true;
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Helper] 激活失败:', e.message);
    return false;
  }
}

// 确保本地助手已连接（点击开始监听时调用）
async function ensureLocalHelperConnected() {
  const status = await checkLocalHelper();

  if (!status.running) {
    // 本地助手未运行，提示用户下载
    if (confirm('需要安装本地助手才能使用自动监听功能。\n\n点击"确定"下载启动脚本，下载后双击运行即可自动连接。')) {
      window.location.href = '/download/start-helper.bat';
    }
    return false;
  }

  // 无论是否已配置，都尝试重新激活（确保 token 是最新的）
  console.log('[Helper] 正在更新本地助手配置...');
  const activated = await activateLocalHelper();
  if (!activated) {
    alert('本地助手配置更新失败，请检查网络连接或重新启动本地助手');
    return false;
  }
  console.log('[Helper] 本地助手配置已更新');

  helperConnected = true;
  return true;
}

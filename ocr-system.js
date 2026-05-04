// ============================================================
//  OCR 子系统（可选加载，不影响线上环境）
//  本地 localhost 自动启用，线上自动关闭
//  调用 Cloudflare Worker 代理，不暴露 API Key
// =============================================================

const OCR_CONFIG = {
  // 本地自动启用，线上也启用（依赖云端 Worker 处理 OCR）
  enabled: true,
  model: 'ep-m-20260426183050-krmx7',
  maxTokens: 2000,
  timeout: 60000,
  batchConcurrency: 2,
  batchInterval: 1500,
};

// 动态获取 OCR 请求地址
function getOcrEndpoint() {
  // 如果配置了 CLOUD_API_BASE 且不是本地环境，优先用云端地址
  if (typeof CLOUD_API_BASE !== 'undefined' && CLOUD_API_BASE && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    // OCR Worker 部署在 www.zhenwu.fun，和页面同域时直接用相对路径
    if (location.hostname === 'www.zhenwu.fun' || location.hostname === 'zhenwu.fun') {
      return '/api/ocr';
    }
    return 'https://www.zhenwu.fun/api/ocr';
  }
  // 本地开发环境
  return '/api/ocr';
}

// ========== 状态 ==========
let ocrQueue = [];
let ocrRunning = false;
let ocrPaused = false;

// ========== 初始化 ==========
function initOCR() {
  if (!OCR_CONFIG.enabled) {
    console.log('[OCR] 已关闭（当前环境：' + location.hostname + '）');
    return;
  }
  console.log('[OCR] 初始化...');
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
      uploadZone.classList.remove('dragover');
      handleBatchUpload(e.dataTransfer.files);
    });
    // 点击上传（HTML 中 uploadZone 的 onclick 会触发 batchInput.click()，这里无需重复绑定）
  }
  // batchInput 的 onchange 在 HTML 中直接绑定 handleBatchUpload(this.files)
}

// ========== OCR API ==========
async function callOCRAPI(base64Data) {
  updateOCRStatus('work', 'OCR 识别中...');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_CONFIG.timeout);

  const promptText = `请识别这张三国谋定天下游戏的战报截图。格式要求：
【左侧】
玩家：xxx
同盟：xxx
阵型：xxx
战损兵力：数字
总兵力：数字
武将1：武将名
战法1：战法A,战法B,战法C
武将2：武将名
战法2：战法D,战法E,战法F
武将3：武将名
战法3：战法G,战法H,战法I
【右侧】
（同上格式）
【结果】
胜负：胜/败/平
注意：每个武将对应3个战法（自带+2个配置），用英文逗号分隔。无法识别用"未知"。`;

  try {
    const reqBody = {
      model: OCR_CONFIG.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: base64Data } },
          { type: 'text', text: promptText }
        ]
      }],
      max_tokens: OCR_CONFIG.maxTokens,
    };

    const apiEndpoint = getOcrEndpoint();
    console.log('[OCR] 请求地址:', apiEndpoint);
    const resp = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
      credentials: 'omit',  // OCR 请求不需要 cookie，避免 CORS 问题
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error('HTTP ' + resp.status + ': ' + errBody.substring(0, 200));
    }

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('API 返回空内容');

    updateOCRStatus('ok', 'OCR 就绪');
    return content;
  } catch (e) {
    clearTimeout(timeout);
    console.error('[OCR] 异常:', e.name, e.message);
    if (e.name === 'AbortError') e.message = 'OCR 请求超时(60秒)，图片可能太大';
    else if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
      e.message = '网络请求失败（可能是 CORS 跨域拦截或网络不通）。请按 F12 打开控制台 → Network 标签，查看 /api/ocr 请求的状态和响应头';
    }
    updateOCRStatus('err', 'OCR 错误: ' + e.message);
    throw e;
  }
}

// ========== 解析 OCR 返回 ==========
function parseOCRResponse(text) {
  const record = {
    time: new Date().toLocaleString('zh-CN'),
    result: '',
    leftPlayer: '',
    leftAlliance: '',
    leftGenerals: [],
    leftTactics: [],
    leftFormation: '',
    leftLoss: null,
    leftTotal: null,
    rightPlayer: '',
    rightAlliance: '',
    rightGenerals: [],
    rightTactics: [],
    rightFormation: '',
    rightLoss: null,
    rightTotal: null,
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let side = '';
  let generalMap = {};
  let tacticsMap = {};

  function flush(sideKey) {
    const indices = Object.keys(generalMap).map(Number).sort((a, b) => a - b);
    const gens = [];
    const tacs = [];
    indices.forEach(i => {
      const g = generalMap[i];
      if (g && g !== '未知') gens.push(g);
      const t = tacticsMap[i] || [];
      tacs.push(...t);
    });
    if (sideKey === 'left') { record.leftGenerals = gens; record.leftTactics = tacs; }
    else if (sideKey === 'right') { record.rightGenerals = gens; record.rightTactics = tacs; }
    generalMap = {};
    tacticsMap = {};
  }

  for (const line of lines) {
    if (line.includes('【左侧】')) {
      if (side === 'left') flush('left'); else if (side === 'right') flush('right');
      side = 'left'; continue;
    }
    if (line.includes('【右侧】')) {
      if (side === 'left') flush('left');
      side = 'right'; continue;
    }
    if (line.includes('【结果】') || line.includes('【胜负】')) {
      if (side === 'left') flush('left'); else if (side === 'right') flush('right');
      side = 'result'; continue;
    }
    const ci = line.indexOf('：');
    if (ci === -1) continue;
    const key = line.substring(0, ci).trim();
    const val = line.substring(ci + 1).trim();

    const gm = key.match(/武将\s*(\d+)/);
    if (gm) { generalMap[parseInt(gm[1])] = val; continue; }
    const tm = key.match(/战法\s*(\d+)/);
    if (tm && !key.includes('战损')) {
      tacticsMap[parseInt(tm[1])] = val.split(/[,，、]+/).map(t => t.trim()).filter(t => t && t !== '未知');
      continue;
    }
    if (key === '武将') {
      const names = val.split(/[,，、\s]+/).filter(n => n && n !== '未知');
      if (side === 'left') record.leftGenerals = names;
      else if (side === 'right') record.rightGenerals = names;
      continue;
    }
    if (key === '战法') {
      const tacts = val.split(/[,，、]+/).map(t => t.trim()).filter(t => t && t !== '未知');
      if (side === 'left') record.leftTactics = tacts;
      else if (side === 'right') record.rightTactics = tacts;
      continue;
    }
    if (key.includes('玩家')) {
      if (side === 'left') record.leftPlayer = val;
      else if (side === 'right') record.rightPlayer = val;
    } else if (key.includes('同盟')) {
      if (side === 'left') record.leftAlliance = val;
      else if (side === 'right') record.rightAlliance = val;
    } else if (key.includes('阵型')) {
      if (side === 'left') record.leftFormation = val;
      else if (side === 'right') record.rightFormation = val;
    } else if (key.includes('战损兵力') || key === '战损') {
      const wanM = val.match(/([\d.]+)\s*万/);
      if (wanM) {
        const v = parseFloat(wanM[1]) * 10000;
        if (side === 'left') record.leftLoss = v; else if (side === 'right') record.rightLoss = v;
      } else {
        const n = val.match(/([\d.]+)/);
        if (n) {
          const v = parseFloat(n[1]);
          if (side === 'left') record.leftLoss = v; else if (side === 'right') record.rightLoss = v;
        }
      }
    } else if (key.includes('总兵力') || key === '总兵') {
      const wanM = val.match(/([\d.]+)\s*万/);
      if (wanM) {
        const v = parseFloat(wanM[1]) * 10000;
        if (side === 'left') record.leftTotal = v; else if (side === 'right') record.rightTotal = v;
      } else {
        const n = val.match(/([\d.]+)/);
        if (n) {
          const v = parseFloat(n[1]);
          if (side === 'left') record.leftTotal = v; else if (side === 'right') record.rightTotal = v;
        }
      }
    } else if ((key.includes('胜负') || key.includes('结果')) && side === 'result') {
      if (val.includes('胜')) record.result = '胜';
      else if (val.includes('败')) record.result = '败';
      else record.result = '平';
    }
  }

  if (side === 'left') flush('left');
  else if (side === 'right') flush('right');

  if (record.leftLoss != null && record.leftTotal != null && record.leftTotal > 0)
    record.leftLossRate = (record.leftLoss / record.leftTotal) * 100;
  if (record.rightLoss != null && record.rightTotal != null && record.rightTotal > 0)
    record.rightLossRate = (record.rightLoss / record.rightTotal) * 100;

  return record;
}

// ========== 批量上传 ==========
function handleBatchUpload(files) {
  if (!files || files.length === 0) return;

  // 积分检查：上传数量不能超过用户积分
  const userPoints = (currentUser && currentUser.points) || 0;
  const maxUpload = userPoints;
  const totalToUpload = files.length;

  if (totalToUpload > maxUpload) {
    showPointsInsufficientModal(userPoints, totalToUpload);
    return;
  }

  for (const file of files) {
    ocrQueue.push({ file, name: file.name, status: 'pending', error: null });
  }
  renderOCRQueue();
  const queueArea = document.getElementById('queueArea');
  if (queueArea) queueArea.style.display = 'block';
}

function renderOCRQueue() {
  const queueCount = document.getElementById('queueCount');
  const queueList = document.getElementById('queueList');
  if (queueCount) queueCount.textContent = ocrQueue.length;

  // 统计可删除的数量（pending / error 状态）
  const deletableCount = ocrQueue.filter(i => i.status === 'pending' || i.status === 'error').length;

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

    // 批量删除按钮（有可删除项时才显示）
    const batchDelBtn = document.getElementById('btnBatchDelQueue');
    if (batchDelBtn) {
      batchDelBtn.style.display = deletableCount > 0 ? 'inline-block' : 'none';
      batchDelBtn.textContent = `🗑 删除已取消 (${deletableCount})`;
      batchDelBtn.onclick = batchRemoveQueue;
    }
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

// 批量删除所有已取消/失败的项
function batchRemoveQueue() {
  const before = ocrQueue.length;
  ocrQueue = ocrQueue.filter(q => q.status === 'processing' || q.status === 'done');
  const removed = before - ocrQueue.length;
  if (removed > 0) {
    renderOCRQueue();
    const queueCount = document.getElementById('queueCount');
    if (queueCount) queueCount.textContent = ocrQueue.length;
    if (ocrQueue.length === 0 && !ocrRunning) {
      const queueArea = document.getElementById('queueArea');
      if (queueArea) queueArea.style.display = 'none';
    }
  }
}

function clearQueue() {
  ocrQueue = ocrQueue.filter(q => q.status === 'processing');
  const queueArea = document.getElementById('queueArea');
  if (!ocrRunning && queueArea) queueArea.style.display = 'none';
  renderOCRQueue();
}

// ========== 文件读取 ==========
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 批量处理 ==========
async function startBatchProcess() {
  if (ocrRunning) return;

  // 检查积分（每张图片扣 1 积分）
  const fileCount = ocrQueue.filter(i => i.status === 'pending').length;
  if (fileCount > 0 && typeof deductUserPoints === 'function') {
    const pts = await getUserPoints(currentUser.phone);
    if (pts < fileCount) {
      showPointsInsufficientModal(pts, fileCount);
      return;
    }
    // 预扣积分（先扣除本次批量所需的积分）
    const deducted = await deductUserPoints(currentUser.phone, fileCount);
    if (!deducted) {
      showPointsInsufficientModal(pts, fileCount);
      return;
    }
    // deductUserPoints 内部已同步 currentUser.points，无需重复扣除
    if (typeof updateUserNavPoints === 'function') updateUserNavPoints();
    updateOCRStatus('work', `已预扣${fileCount}积分，余额：${(currentUser.points||0)}分`);
  }

  ocrRunning = true;
  ocrPaused = false;

  const btnStart = document.getElementById('btnStartBatch');
  const btnPause = document.getElementById('btnPauseBatch');
  if (btnStart) btnStart.disabled = true;
  if (btnPause) btnPause.disabled = false;

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
        const rawResult = await callOCRAPI(base64);
        const record = parseOCRResponse(rawResult);
        record.imageBase64 = base64;
        record.imageName = item.name;
        record.imageTime = new Date().toLocaleString('zh-CN');
        if (typeof dbAdd === 'function') {
          const newId = await dbAdd(record);
          // 记录系统日志
          if (typeof addSysLog === 'function') {
            addSysLog('action', '上传战报: ' + (record.leftPlayer || record.rightPlayer || item.name) + (window.currentProjectId ? ' [项目ID:' + window.currentProjectId + ']' : ''));
          }
          // 同步更新项目的 battleRecordIds
          if (window.currentProjectId && typeof addBattleToProject === 'function' && newId) {
            await addBattleToProject(window.currentProjectId, newId);
          }
        }
        item.status = 'done';
      } catch (e) {
        try {
          if (!base64) base64 = await readFileAsBase64(item.file);
          if (typeof dbAdd === 'function') {
            const errRec = {
              imageBase64: base64,
              imageName: item.name,
              imageTime: new Date().toLocaleString('zh-CN'),
              leftGenerals: [], rightGenerals: [],
              leftTactics: [], rightTactics: [],
              _parseError: true, _errorMsg: e.message,
            };
            const newId = await dbAdd(errRec);
            // 同步更新项目的 battleRecordIds
            if (window.currentProjectId && typeof addBattleToProject === 'function' && newId) {
              await addBattleToProject(window.currentProjectId, newId);
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
  ocrPaused = !ocrPaused;
  const btn = document.getElementById('btnPauseBatch');
  if (btn) btn.textContent = ocrPaused ? '▶ 继续' : '⏸ 暂停';
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

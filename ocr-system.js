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
  timeout: 120000,    // 视觉模型识别大图可能较久，从60s提升到120s
  batchConcurrency: 2,
  batchInterval: 1500,
};

// 动态获取 OCR 请求地址
function getOcrEndpoint() {
  // 统一用 CLOUD_API_BASE（已区分本地3000/生产api.zhenwu.fun），避免打到静态服务器
  if (typeof CLOUD_API_BASE !== 'undefined' && CLOUD_API_BASE) {
    return CLOUD_API_BASE + '/ocr';
  }
  // 兜底：本地后端地址
  return 'http://localhost:3000/api/ocr';
}

// ========== 状态 ==========
let ocrQueue = [];
let ocrRunning = false;
let ocrPaused = false;
let batchAbortController = null;  // 用于中止正在进行的 OCR 请求（暂停时使用）
let ocrPausedByUser = false;      // 标记是否为用户主动暂停导致的中止

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
      uploadZone.classList.remove('dragover');
      handleBatchUpload(e.dataTransfer.files);
    });
    // 点击上传（HTML 中 uploadZone 的 onclick 会触发 batchInput.click()，这里无需重复绑定）
  }
  // batchInput 的 onchange 在 HTML 中直接绑定 handleBatchUpload(this.files)
}

// ========== OCR API ==========
async function callOCRAPI(base64Data, externalSignal = null) {
  const startTime = Date.now();
  updateOCRStatus('work', 'OCR 识别中...');
  // 定时更新状态文字，显示已等待时间，让用户知道没卡死
  const statusTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    updateOCRStatus('work', `OCR 识别中...(${elapsed}s)`);
  }, 3000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_CONFIG.timeout);

  // 将外部中止信号（用户暂停）转发给内部 controller
  let onExternalAbort;
  if (externalSignal) {
    onExternalAbort = () => controller.abort();
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  const promptText = `你是三国谋定天下游戏战报识别专家。请仔细分析这张战报截图，严格按照格式输出所有字段。

【画面布局说明】
- 画面分左右两半，中央有"胜"或"败"大字结果
- 每侧顶部有两个**物理位置相距较远**的独立区域（不在同一行）：
  ① 玩家名称区：位于页面上方，字体较大，单独显示玩家自己的名字
  ② 同盟名称区：位于玩家区下方（中间有空白），字体较小/颜色不同，**只显示同盟名，没有玩家名**
  ③ 阵型标签：显示阵型名称（如"方圆阵"、"雁行阵"、"鱼鳞阵"、"锋矢阵"、"箕形阵"等）
  **极其重要**：玩家名中若出现"丨"（如"风云丨天下"），这只是玩家的取名风格，"丨"左侧的文字是玩家名的一部分，**严禁**把"丨"左侧的文字当作同盟名填入同盟字段。同盟字段**只能**从画面上玩家名下方的同盟名称区域读取
- 每侧中部：三位武将的头像卡片横向排列，头像下方有武将名字
- 每侧底部：三列战法框，每列对应上方的武将，每个框内列出该武将的战法名称（战法名旁边可能有"×数字"表示叠加层数，忽略这些数字，只取战法名称）
- 每侧顶部数字区：显示"战损:XXXX"（已损失兵力）和总兵力数字（通常格式为"XXXX/XXXXX"，斜线前为战损、斜线后为总兵）

【识别规则】
1. 同盟名：**只能**从画面中玩家名**下方**的同盟名称区域读取（字体较小，与玩家名区域不在同一行）。如果找不到独立的同盟名称区域，填"未知"。**严禁**从玩家名中提取或按"丨"拆分玩家名来获取同盟名
2. 玩家名：从玩家名称区域单独读取，完整保留，即使含有"丨"也不要拆分（"丨"是玩家名的一部分）
3. 阵型：读取顶部阵型标签文字（如方圆阵、雁行阵等）
4. 战损/总兵：找"战损"数值和总兵力数值，均为纯整数
5. 武将名：读取三个头像下方的名字，从左到右为武将1、2、3
6. 战法：每位武将下方的战法框中，每行一个战法名。注意："影本·XXXX"是一个完整战法名，不要拆成"影本"和"XXXX"两个。忽略"×数字"叠层标记，提取战法名用英文逗号分隔，每位武将通常有2-4个战法
7. 结果："胜"或"败"或"平"，从画面中央大字判断（左侧视角：中央显示"胜"则左侧=胜）
8. 无法识别的文字填"未知"，数字填0

【输出格式（严格按此格式，不要增减字段）】
【左侧】
同盟：xxx
玩家：xxx
阵型：xxx
战损：数字
总兵：数字
武将1：武将名
战法1：战法A,战法B,战法C
武将2：武将名
战法2：战法D,战法E,战法F
武将3：武将名
战法3：战法G,战法H,战法I
【右侧】
同盟：xxx
玩家：xxx
阵型：xxx
战损：数字
总兵：数字
武将1：武将名
战法1：战法A,战法B,战法C
武将2：武将名
战法2：战法D,战法E,战法F
武将3：武将名
战法3：战法G,战法H,战法I
【结果】
胜负：胜或败或平
【日期】
战斗日期：YYYY-MM-DD（无法识别则留空）

【正确与错误对照（极其重要）】
假设玩家名区域显示：风云丨天下，同盟名区域显示：傲世天下
✅ 正确输出：玩家：风云丨天下  同盟：傲世天下
❌ 严禁输出：玩家：天下  同盟：风云  （这是拆分玩家名的错误行为！）
核心原则：玩家名区域里写的什么就完整复制什么，同盟名去同盟区域找，两者绝对不能混用！`;

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
    const ocrToken = typeof getToken === 'function' ? getToken() : '';
    const resp = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ocrToken ? { 'Authorization': 'Bearer ' + ocrToken } : {})
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
      credentials: 'omit',  // OCR 请求不需要 cookie，避免 CORS 问题
    });

    clearTimeout(timeout);
    clearInterval(statusTimer);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);

    if (!resp.ok) {
      const errBody = await resp.text();
      // 账号被删/禁时，触发与 cloudRequest 一致的强制退出逻辑
      if (resp.status === 401) {
        let errMsg = '';
        try { errMsg = JSON.parse(errBody).message || ''; } catch(e) {}
        const isFatal = errMsg.includes('账号不存在') || errMsg.includes('已被禁用') || errMsg.includes('已被删除') || errMsg.includes('登录状态已过期');
        if (isFatal) {
          if (typeof setToken === 'function') setToken(null);
          if (typeof clearSession === 'function') clearSession();
          if (typeof userDBDelete === 'function' && typeof currentUser !== 'undefined' && currentUser && currentUser.phone) {
            try { await userDBDelete(currentUser.phone); } catch(e) {}
          }
          if (typeof currentUser !== 'undefined') currentUser = null;
          setTimeout(() => {
            alert((errMsg || '您的账号已被删除或禁用') + '，即将退出登录');
            if (typeof showLogin === 'function') showLogin(); else location.reload();
          }, 0);
        }
      }
      throw new Error('HTTP ' + resp.status + ': ' + errBody.substring(0, 200));
    }

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('API 返回空内容');

    updateOCRStatus('ok', 'OCR 就绪');
    clearInterval(statusTimer);
    return content;
  } catch (e) {
    clearTimeout(timeout);
    clearInterval(statusTimer);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
    console.error('[OCR] 异常:', e.name, e.message);
    // 仅超时中止（非用户主动暂停）才改写错误信息
    if (e.name === 'AbortError' && !(externalSignal && externalSignal.aborted)) {
      e.message = 'OCR 请求超时(120秒)，图片可能太大，请尝试压缩后重试';
    } else if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
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
  let rawText = text; // 保存原始文本用于兜底解析

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let side = '';
  let generalMap = {};
  let tacticsMap = {};
  let battleDate = ''; // OCR 识别到的战斗日期

  function flush(sideKey) {
    const indices = Object.keys(generalMap).map(Number).sort((a, b) => a - b);
    // generalMap 为空说明模型使用了无编号格式（武将：xxx），已由 key==='武将' 分支设置，不覆盖
    if (indices.length > 0) {
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
    }
    generalMap = {};
    tacticsMap = {};
  }

  for (const line of lines) {
    // 兼容多种 section 标题写法：【左侧】 / 左侧 / **左侧** / ## 左侧
    const isLeft   = line.includes('【左侧】')  || /^[*#\s]*左侧[*#\s：:]*$/.test(line);
    const isRight  = line.includes('【右侧】')  || /^[*#\s]*右侧[*#\s：:]*$/.test(line);
    const isResult = line.includes('【结果】')  || line.includes('【胜负】') ||
                     /^[*#\s]*(结果|胜负)[*#\s：:]*$/.test(line);
    if (isLeft) {
      if (side === 'left') flush('left'); else if (side === 'right') flush('right');
      side = 'left'; continue;
    }
    if (isRight) {
      if (side === 'left') flush('left');
      side = 'right'; continue;
    }
    if (isResult) {
      if (side === 'left') flush('left'); else if (side === 'right') flush('right');
      side = 'result'; continue;
    }
    // 支持全角：和半角 : 两种冒号
    let ci = line.indexOf('：');
    if (ci === -1) ci = line.indexOf(':');
    if (ci === -1) continue;
    const key = line.substring(0, ci).trim();
    const val = line.substring(ci + 1).trim();

    const gm = key.match(/武将\s*(\d+)/);
    if (gm) { generalMap[parseInt(gm[1])] = val; continue; }
    const tm = key.match(/战法\s*(\d+)/);
    if (tm && !key.includes('战损')) {
      tacticsMap[parseInt(tm[1])] = val.split(/[,，、]+/).map(t => t.trim()).filter(t => t && t !== '未知' && t !== '影本').map(t => t.replace(/^影本[·.•]/, ''));
      continue;
    }
    if (key === '武将') {
      const names = val.split(/[,，、\s]+/).filter(n => n && n !== '未知');
      if (side === 'left') record.leftGenerals = names;
      else if (side === 'right') record.rightGenerals = names;
      continue;
    }
    if (key === '战法') {
      const tacts = val.split(/[,，、]+/).map(t => t.trim()).filter(t => t && t !== '未知' && t !== '影本').map(t => t.replace(/^影本[·.•]/, ''));
      if (side === 'left') record.leftTactics = tacts;
      else if (side === 'right') record.rightTactics = tacts;
      continue;
    }
    if (key.includes('玩家') || key.includes('玩家名')) {
      // 玩家名完整保留，不按竖线拆分（玩家名本身可能含丨）
      const name = val.trim();
      if (side === 'left') record.leftPlayer = name;
      else if (side === 'right') record.rightPlayer = name;
    } else if (key.includes('同盟')) {
      // 同盟名来自独立区域，直接使用（丨是同盟名合法字符，不拆分）
      let allianceVal = val.trim();
      if (allianceVal === '无' || allianceVal === '未知') allianceVal = '';
      if (side === 'left') record.leftAlliance = allianceVal;
      else if (side === 'right') record.rightAlliance = allianceVal;
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
    } else if (key.includes('日期') || key.includes('时间') || key.includes('战斗日期')) {
      // 尝试解析 YYYY-MM-DD 格式日期
      const dateMatch = val.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
      if (dateMatch) {
        const y = dateMatch[1], m = dateMatch[2].padStart(2,'0'), d = dateMatch[3].padStart(2,'0');
        battleDate = `${y}-${m}-${d}`;
      }
    }
  }

  if (side === 'left') flush('left');
  else if (side === 'right') flush('right');

  if (record.leftLoss != null && record.leftTotal != null && record.leftTotal > 0)
    record.leftLossRate = (record.leftLoss / record.leftTotal) * 100;
  if (record.rightLoss != null && record.rightTotal != null && record.rightTotal > 0)
    record.rightLossRate = (record.rightLoss / record.rightTotal) * 100;

  // ========== 兜底：修复模型拆分玩家名的三类错误 ==========
  const pipeRe2 = /[|｜丨]/;

  // 先从原始文本提取所有候选名字（含丨的优先用于修复拆分）
  const namePattern = /([一-龥a-zA-Z0-9·•\-|]{2,15})/g;
  const allMatches = [...rawText.matchAll(namePattern)].map(m => m[1]);
  const excludeWords = ['左侧','右侧','结果','胜负','胜','败','平','未知','雁形阵','箕形阵','鱼鳞阵','方圆阵','长蛇阵','锋矢阵','虎翼阵','阵型','战法','武将','兵力','总兵','战损','同盟','玩家','玩家名','战斗日期'];
  const candidates = [...new Set(allMatches)].filter(n => {
    if (n.length < 2 || n.length > 15) return false;
    if (excludeWords.some(w => n.includes(w))) return false;
    if (/^\d+$/.test(n)) return false;
    return true;
  });
  const fullNameCandidates = candidates.filter(n => pipeRe2.test(n));
  const plainCandidates = candidates.filter(n => !pipeRe2.test(n));

  ['left', 'right'].forEach(side => {
    const ply = record[side + 'Player'];
    const ally = record[side + 'Alliance'];

    // Case A: 玩家名含丨，同盟名==丨前缀 → 清空同盟
    if (ply && ally && pipeRe2.test(ply)) {
      const prefix = ply.split(pipeRe2)[0].trim();
      if (prefix === ally) record[side + 'Alliance'] = '';
    }

    // Case B: 玩家名不含丨（已被模型拆分），从原始文本找回完整名
    // 模型输出"玩家：天下"+"同盟：风云"，但原始文本中仍有"风云丨天下"
    if (ally && (!ply || !pipeRe2.test(ply))) {
      const matchedFull = fullNameCandidates.find(fn => {
        const parts = fn.split(pipeRe2);
        return parts.length >= 2 && parts[0].trim() === ally;
      });
      if (matchedFull) {
        record[side + 'Player'] = matchedFull;
        record[side + 'Alliance'] = '';
      }
    }
  });

  // Case C: 玩家名为空，用候补名填充（含丨的优先，去重避免左右同名）
  if (!record.leftPlayer || !record.rightPlayer) {
    const usedNames = new Set();
    if (record.leftPlayer) usedNames.add(record.leftPlayer);
    if (record.rightPlayer) usedNames.add(record.rightPlayer);
    const pool = [...fullNameCandidates, ...plainCandidates].filter(n => !usedNames.has(n));
    if (!record.leftPlayer && pool.length > 0) { record.leftPlayer = pool[0]; usedNames.add(pool[0]); }
    if (!record.rightPlayer) {
      const remaining = pool.filter(n => !usedNames.has(n));
      if (remaining.length > 0) record.rightPlayer = remaining[0];
    }
  }

  // 写入识别到的战斗日期（OCR 识别不到则为空，由调用方补默认值）
  record.battleDate = battleDate || '';
  return record;
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

  // 从云端获取最新积分（管理员可能已调整）
  let userPoints = (currentUser && currentUser.points) || 0;
  try {
    if (currentUser && typeof getUserPoints === 'function') {
      userPoints = await getUserPoints(currentUser.phone);
    }
  } catch (e) { /* 网络问题，回退到本地缓存值 */ }

  const totalToUpload = files.length;

  // 选中图片数量超过剩余积分，立即拦截并弹窗提示
  if (totalToUpload > userPoints) {
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
    folderProcessedSet = loadFolderProcessed(handle.name);
    folderNewCount = 0;
    updateFolderWatchStats();
  } catch (e) {
    if (e.name !== 'AbortError') alert('选择文件夹失败：' + e.message);
  }
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
        const rawResult = await callOCRAPI(base64, batchAbortController ? batchAbortController.signal : null);
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
        // OCR 成功后扣 1 积分（失败不扣）
        if (typeof deductUserPoints === 'function' && currentUser) {
          const deducted = await deductUserPoints(currentUser.phone, 1);
          if (deducted) {
            if (typeof updateUserNavPoints === 'function') updateUserNavPoints();
          } else {
            // 积分已耗尽，停止批处理
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
        }
      } catch (e) {
        // 用户主动暂停导致的中止：将当前项重置为待处理，等待"继续"重新处理
        if (e.name === 'AbortError' && ocrPausedByUser) {
          item.status = 'pending';
          item.error = null;
          processing--;
          renderOCRQueue();
          updateOCRProgress();
          // 停止循环，由"继续"按钮重新启动 startBatchProcess
          ocrRunning = false;
          if (btnStart) btnStart.disabled = false;
          if (btnPause) { btnPause.disabled = false; /* 保持"继续"文字 */ }
          updateOCRStatus('ok', '已暂停，点击"继续"恢复');
          return;
        }
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

/* ==========================================================
   DATA SYSTEM - 战报数据管理（IndexDB 操作 + 表格渲染）
   ========================================================== */

// ========== 全局状态 ==========
let db = null;
let allRecords = [];
let batchQueue = [];
let batchPaused = false;
let batchRunning = false;
let dataPage = 1;
const DATA_PER_PAGE = 20;
let winRateSortField = null;
let winRateSortDir = 'desc';
let gallerySelectedIds = new Set();
let cachedWinRateData = [];

// ========== IndexedDB ==========
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('SanmoBattleDB', 2);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('records'))
        d.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function dbAdd(rec) {
 if (!db) await openDB();
 return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const store = tx.objectStore('records');
    // 绑定项目 ID 和上传者
    rec.projectId = window.currentProjectId || '';
    rec.user_phone = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.phone : '';
    rec.time = rec.time || new Date().toLocaleString('zh-CN');
    const req = store.add(rec);
    req.onsuccess = () => {
      rec.id = req.result;
      // 只添加到当前视图（已过滤的 allRecords）
      allRecords.push({ ...rec });
      updateGlobalStats();
      syncToLocalStorage();
      renderDataTable();
      
      // 同步到云端
      if(window.cloudSync){
        const cloudRec = { ...rec };
        cloudRec.project_id = rec.projectId || null;
        cloudRec.user_phone = rec.user_phone;
        cloudRec.data = rec;  // 整个战报数据存到 data 字段
        delete cloudRec.projectId;  // 使用 project_id
        try{
          window.cloudSync.createRecord(cloudRec).then(result => {
            if(result && result.id){
              console.log('[Cloud] 战报已同步到云端:', result.id);
              // 如果云端返回了不同的 ID，更新本地
              if(result.id !== rec.id){
                // 可选：更新本地记录的云端 ID 映射
              }
            }
          }).catch(e => console.error('[Cloud] 战报同步失败:', e));
        }catch(e){console.error('[Cloud] 战报同步异常:', e);}
      }
      
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function dbPut(rec) {
 return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').put(rec);
    req.onsuccess = () => {
      // 同步到云端
      if(window.cloudSync && rec.id){
        try{
          window.cloudSync.updateRecord(rec.id, rec).catch(e => console.error('[Cloud] 更新失败:', e));
        }catch(e){console.error('[Cloud] 同步异常:', e);}
      }
      resolve(rec.id);
    };
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readonly');
    const req = tx.objectStore('records').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
 return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').delete(id);
    req.onsuccess = () => {
      // 先从云端删除
      if(window.cloudSync){
        try{
          window.cloudSync.deleteRecord(id).catch(e => console.error('[Cloud] 删除失败:', e));
        }catch(e){console.error('[Cloud] 删除异常:', e);}
      }
      
      allRecords = allRecords.filter(r => r.id !== id);
      gallerySelectedIds.delete(id);
      updateGlobalStats();
      renderDataTable();
      renderGallery();
      syncToLocalStorage();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function dbClear() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').clear();
    req.onsuccess = () => { syncToLocalStorage(); resolve(); };
    req.onerror = () => reject(req.error);
  });
}

async function loadAllRecords() {
  try {
    let records = await dbGetAll();
    // 旧数据迁移：为没有 projectId/uploader 的记录补全字段
    const migratePromises = [];
    for (const rec of records) {
      let changed = false;
      if (rec.projectId === undefined) { rec.projectId = ''; changed = true; }
      if (rec.uploader === undefined) { rec.uploader = ''; changed = true; }
      if (changed) migratePromises.push(dbPut(rec));
    }
    if (migratePromises.length > 0) await Promise.all(migratePromises);
    // 按项目过滤
    const pid = window.currentProjectId;
    if (pid) {
      allRecords = records.filter(r => r.projectId === pid);
    } else {
      // 无项目过滤：超管看全部，普通用户只看有权限项目的战报
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'super_admin') {
        // 获取当前用户可见的项目 ID 集合（含自建+成员+公开+授权）
        let visibleProjIds = new Set();
        try {
          const visProjs = await (typeof getVisibleProjects === 'function' ? getVisibleProjects() : Promise.resolve([]));
          visProjs.forEach(p => visibleProjIds.add(p.id));
        } catch(e) {}
        allRecords = records.filter(r =>
          !r.projectId ||                          // 无项目关联的旧数据
          visibleProjIds.has(r.projectId)           // 有权限访问的项目
        );
      } else {
        allRecords = records;
      }
    }
  } catch (e) {
    allRecords = [];
  }
  // 从 localStorage 兜底（仅在无项目时）
  if (allRecords.length === 0 && !window.currentProjectId) {
    const b = localStorage.getItem('sanmo_records_backup');
    if (b) {
      try {
        const r = JSON.parse(b);
        if (r.length > 0) {
          for (const rec of r) {
            if (!rec.projectId) rec.projectId = '';
            if (!rec.uploader) rec.uploader = '';
            try { await dbAdd(rec); } catch (e) { }
          }
          allRecords = await dbGetAll();
          if (window.currentProjectId) {
            allRecords = allRecords.filter(r => r.projectId === window.currentProjectId);
          }
        }
      } catch (e) { }
    }
  }
  updateGlobalStats();
}

function syncToLocalStorage() {
  try {
    setTimeout(() => {
      dbGetAll().then(records => {
        const lite = records.map(r => {
          const { imageBase64, ...rest } = r;
          return rest;
        });
        try {
          localStorage.setItem('sanmo_records_backup', JSON.stringify(lite));
        } catch (e) {
          try {
            localStorage.setItem('sanmo_records_backup', JSON.stringify(lite.slice(-100)));
          } catch (e2) { }
        }
      });
    }, 100);
  } catch (e) { }
}

// ========== OCR STATUS ==========
function updateOcrStatus(status, text) {
  const dot = document.getElementById('ocrDot');
  const txt = document.getElementById('ocrText');
  if (dot) dot.className = 'ocr-dot ' + status;
  if (txt) txt.textContent = text;
}
updateOcrStatus('ok', 'OCR 就绪');

// ========== 隐藏所有子导航 ==========
function hideAllSubNav() {
  const projectSubNav = document.getElementById('projectSubNav');
  const systemSubNav = document.getElementById('systemSubNav');
  if (projectSubNav) projectSubNav.style.display = 'none';
  if (systemSubNav) systemSubNav.style.display = 'none';
  // 清除所有子导航按钮的 active 状态
  document.querySelectorAll('.nav').forEach(nav => {
    if (nav.id !== 'topNav') {
      nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    }
  });
}

// ========== TAB SWITCHING ==========
// 属于项目模块的 tab 列表（需要在这些 tab 下显示 projectSubNav 和 projectBar）
const PROJECT_TABS = ['data','winrate'];

// tabId → 所需权限 key（空字符串表示无需权限）
const TAB_PERM_MAP = {
  'project': 'projectManage',
  'library': 'library',
  'ranking': 'ranking',
  'peijiang': 'peijiang',
  'yanwu': 'yanwu',
  'system': 'systemConfig',
  'user': 'userManage',
  'syslog': 'syslog',
  'datamgmt': 'dataManage',
  'rolemanage': 'rolemanage',
  'dataperm': 'dataperm',
  'data': 'dataImport',
  'winrate': 'winrateAnalysis',
  // 以下无需权限
  'login': '', 'register': '', 'home': '',
};

async function switchTab(tabId, btn) {
  // 权限检查
  const requiredPerm = TAB_PERM_MAP[tabId] ?? null;
  if(requiredPerm !== null && requiredPerm !== ''){
    const perms = await getRolePermissions(currentUser?.role);
    if(!perms || !perms[requiredPerm]){
      console.warn('[switchTab] 权限不足:', tabId, '需要:', requiredPerm);
      return;
    }
  }

  console.log('[switchTab] 切换到:', tabId);

  // 先隐藏所有 tab-content（强制用 !important 等价于设置 inline style）
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.setProperty('display', 'none', 'important');
    el.classList.remove('active');
  });

  const tab = document.getElementById('tab-' + tabId);
  if (tab) {
    tab.style.setProperty('display', 'block', 'important');
    tab.classList.add('active');
    console.log('[switchTab] 已显示 tab:', tabId, '| offsetParent:', tab.offsetParent);
  }

  // 调试：检查是否还有其他 tab-content 是可见的
  const visible = [];
  document.querySelectorAll('.tab-content').forEach(el => {
    const style = window.getComputedStyle(el);
    const isHidden = style.display === 'none';
    if (!isHidden && el.offsetParent !== null) {
      visible.push(el.id || el.className);
      console.log('[switchTab-DEBUG] 可见tab:', el.id, '| parent:', el.parentNode.id || el.parentNode.tagName, '| display:', style.display, '| offsetParent:', el.offsetParent?.id || el.offsetParent?.tagName);
    }
  });
  if (visible.length > 0 && !visible.includes('tab-' + tabId)) {
    console.warn('[switchTab] 警告：以下 tab 仍然可见（非当前tab）:', visible);
  } else if (visible.includes('tab-' + tabId)) {
    console.log('[switchTab] 当前tab可见（正常）:', 'tab-' + tabId);
  }
  // 只在点击按钮所属的导航栏内高亮
  if (btn) {
    const navBar = btn.closest('.nav');
    if(navBar) navBar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  // 项目模块 tab（data/winrate）：显示项目子导航；其他 tab：隐藏项目相关 UI
  const sn = document.getElementById('projectSubNav');
  const bar = document.getElementById('projectBar');
  const tp = document.getElementById('tab-project');
  const ssn = document.getElementById('systemSubNav');
  const SYS_TABS = ['user','syslog','datamgmt','rolemanage','dataperm','cloudservice'];
  if (PROJECT_TABS.includes(tabId)) {
    // 进入项目内 tab：显示项目子导航，隐藏系统子导航
    if (sn) sn.style.display = 'flex';
    if (bar) bar.style.display = 'flex';
    if (ssn) ssn.style.display = 'none';
  } else if (SYS_TABS.includes(tabId)) {
    // 进入系统配置子 tab：显示系统子导航，隐藏项目子导航
    if (ssn) ssn.style.display = 'flex';
    if (sn) sn.style.display = 'none';
    if (bar) bar.style.display = 'none';
  } else if (tabId === 'project') {
    // 项目管理页：隐藏所有子导航，显示项目列表
    if (sn) sn.style.display = 'none';
    if (ssn) ssn.style.display = 'none';
    if (bar) bar.style.display = 'none';
    if (tp) tp.style.display = 'block';
  } else {
    // 其他模块：隐藏所有子导航和项目 UI
    if (sn) sn.style.display = 'none';
    if (ssn) ssn.style.display = 'none';
    if (bar) bar.style.display = 'none';
    if (tp) tp.style.display = 'none';
  }
  if (tabId === 'data') { renderDataTable(); renderGallery(); }
  if (tabId === 'winrate') { updateWinRateFilters(); renderWinRateTable(); renderEnemyFreq(); }
  if (tabId === 'library') { renderHeroes(); renderTactics(); }
  if (tabId === 'ranking') renderRanking();
  if (tabId === 'peijiang') onPeijiangChange();
  if (tabId === 'yanwu') onYanwuChange();
  if (tabId === 'project') { if(typeof renderProjectManage==='function') renderProjectManage(); }
  if (tabId === 'user') { if(typeof renderUserManage==='function') renderUserManage(); }
  if (tabId === 'syslog') { if(typeof renderSysLog==='function') renderSysLog(); }
  if (tabId === 'rolemanage') { if(typeof renderRoleManage==='function') renderRoleManage(); }
  if (tabId === 'dataperm') {
    console.log('[switchTab] dataperm tab 激活，renderDataPerm 类型:', typeof renderDataPerm);
    if (typeof renderDataPerm === 'function') {
      renderDataPerm();
    } else {
      // 兜底：data-perm.js 可能还在缓存，加载一次
      console.warn('[switchTab] renderDataPerm 未定义，尝试动态加载 data-perm.js...');
      const c = document.getElementById('dataPermContent');
      if (c) c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text2);">⏳ 加载中，请稍候...</div>';
      var s = document.createElement('script');
      s.src = 'data-perm.js?v=' + Date.now();
      s.onload = function() { console.log('[switchTab] data-perm.js 动态加载成功'); if(typeof renderDataPerm==='function') renderDataPerm(); };
      s.onerror = function() { if(c) c.innerHTML = '<div style="padding:40px;text-align:center;color:#ff5252;">❌ data-perm.js 加载失败，请 Ctrl+Shift+R 刷新</div>'; };
      document.head.appendChild(s);
    }
  }
  if (tabId === 'cloudservice') { if(typeof refreshDBUsage==='function') refreshDBUsage(); }
  if (tabId === 'system') {
    // 系统配置：调用 showSystemConfig 切换第一个可见子菜单
    if(typeof showSystemConfig==='function') showSystemConfig();
  }

  console.log('[switchTab] 切换完成:', tabId);
}

// ========== 云端服务：刷新数据库占用统计 ==========
async function refreshDBUsage() {
  // 1. 总 IndexedDB 占用（estimate）
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const pct = quota > 0 ? (used / quota * 100) : 0;
      document.getElementById('dbUsageUsed').textContent = (used / 1024 / 1024).toFixed(2) + ' MB';
      document.getElementById('dbUsageQuota').textContent = (quota / 1024 / 1024).toFixed(2) + ' MB';
      document.getElementById('dbUsagePct').textContent = pct.toFixed(1) + '%';
      document.getElementById('dbUsageFill').style.width = Math.min(pct, 100) + '%';
      // 颜色：>80% 红，>50% 黄，否则蓝
      if (pct > 80) {
        document.getElementById('dbUsageFill').style.background = 'linear-gradient(90deg, #ff5252, #ff8a80)';
      } else if (pct > 50) {
        document.getElementById('dbUsageFill').style.background = 'linear-gradient(90deg, #ffab40, #ffd740)';
      } else {
        document.getElementById('dbUsageFill').style.background = 'linear-gradient(90deg, var(--accent), var(--cyan))';
      }
    } catch(e) {
      console.error('[refreshDBUsage] estimate 失败:', e);
    }
  } else {
    document.getElementById('dbUsageUsed').textContent = '浏览器不支持';
  }

  // 2. 各数据库记录数（数据库名需与实际一致）
  const dbInfo = [
    { name: 'SanmoBattleDB', store: 'records' },
    { name: 'SanMoUserDB', store: 'users' },
    { name: 'nslg_syslog', store: 'logs' },
    { name: 'nslg_roles', store: 'roles' }
  ];
  let detailsHTML = '';
  for (const db of dbInfo) {
    try {
      const count = await new Promise((resolve) => {
        const req = indexedDB.open(db.name);
        req.onsuccess = function() {
          const database = req.result;
          if (!database.objectStoreNames || !database.objectStoreNames.contains(db.store)) {
            database.close();
            resolve(0);
            return;
          }
          try {
            const tx = database.transaction(db.store, 'readonly');
            const store = tx.objectStore(db.store);
            const countReq = store.count();
            countReq.onsuccess = function() {
              database.close();
              resolve(countReq.result);
            };
            countReq.onerror = function() { try{database.close();}catch(e){} resolve(0); };
          } catch(ex) {
            try{database.close();}catch(e){}
            resolve(0);
          }
        };
        req.onerror = function() { resolve(0); };
      });
      detailsHTML += `<div>🗃️ <b>${db.name}</b>.<span style="color:var(--text3);">${db.store}</span>：<span style="color:var(--accent);">${count}</span> 条记录</div>`;
    } catch(e) {
      detailsHTML += `<div>🗃️ <b>${db.name}</b>：读取失败</div>`;
    }
  }
  const el = document.getElementById('dbDetails');
  if (el) el.innerHTML = detailsHTML || '暂无数据';
}

function switchLibSub(sub) {
  document.getElementById('libSubHeroes').style.display = sub === 'heroes' ? 'block' : 'none';
  document.getElementById('libSubTactics').style.display = sub === 'tactics' ? 'block' : 'none';
  document.getElementById('libTabHeroes').classList.toggle('active', sub === 'heroes');
  document.getElementById('libTabTactics').classList.toggle('active', sub === 'tactics');
  if (sub === 'heroes') renderHeroes();
  else renderTactics();
}

// ========== GLOBAL STATS ==========
function updateGlobalStats() {
  const elTotal = document.getElementById('statTotal');
  const elTeams = document.getElementById('statTeams');
  const elDataCount = document.getElementById('dataCount');
  if (elTotal) elTotal.textContent = allRecords.length;
  const teams = new Set();
  allRecords.forEach(r => {
    teams.add(getTeamKey(r.leftGenerals));
    teams.add(getTeamKey(r.rightGenerals));
  });
  if (elTeams) elTeams.textContent = teams.size;
  if (elDataCount) elDataCount.textContent = allRecords.length + ' 条';
}

// ========== TEAM HELPERS ==========
function getTeamKey(generals) {
  if (!generals || generals.length === 0) return '未知';
  return generals.filter(g => g && g.trim()).map(g => g.trim()).sort().join(',') || '未知';
}

function getTacticsKey(tactics) {
  if (!tactics || tactics.length === 0) return '';
  return tactics.filter(t => t && t.trim()).map(t => t.trim()).sort().join(',') || '';
}

function isSameTeamType(gA, tA, gB, tB) {
  const ga = (gA || []).filter(g => g && g.trim()).map(g => g.trim()).sort();
  const gb = (gB || []).filter(g => g && g.trim()).map(g => g.trim()).sort();
  if (ga.length >= 3 && gb.length >= 3 && ga.length === gb.length && ga.every((v, i) => v === gb[i])) return true;
  const ta = (tA || []).filter(t => t && t.trim()).map(t => t.trim()).sort();
  const tb = (tB || []).filter(t => t && t.trim()).map(t => t.trim()).sort();
  if (ta.length >= 3 && tb.length >= 3 && ta.length === tb.length && ta.every((v, i) => v === tb[i])) return true;
  return false;
}

function escHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtNum(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString('zh-CN');
}

function getTeamDisplay(generals) {
  if (!generals || generals.length === 0) return '-';
  return generals.slice(0, 3).map(g => escHtml(g)).join('<br>');
}

function getTacticsDisplay(generals, tactics) {
  if (!generals || generals.length === 0) return '-';
  let html = '<div style="display:flex;flex-direction:column;gap:3px;">';
  for (let i = 0; i < Math.min(3, generals.length); i++) {
    const base = i * 3;
    const fm = tactics?.[base] || '';
    const t1 = tactics?.[base + 1] || '';
    const t2 = tactics?.[base + 2] || '';
    const parts = [fm, t1, t2].filter(t => t && t !== '未知');
    html += `<div style="display:flex;align-items:baseline;gap:4px;white-space:nowrap;"><span style="color:var(--blue);font-weight:bold;font-size:11px;min-width:40px;">${escHtml(generals[i])}</span><span style="color:var(--text2);font-size:10px;">${parts.length ? parts.map(t => escHtml(t)).join(' / ') : '-'}</span></div>`;
  }
  html += '</div>';
  return html;
}

function getLossColor(rate) {
  if (rate == null) return 'var(--text2)';
  if (rate <= 30) return 'var(--green)';
  if (rate <= 60) return 'var(--accent)';
  return 'var(--red)';
}

// ========== TAB 1: DATA TABLE ==========
function getFilteredData() {
  let data = [...allRecords];
  const search = (document.getElementById('dataSearch')?.value || '').toLowerCase();
  const filterR = document.getElementById('dataFilterResult')?.value || '';
  if (search) {
    data = data.filter(r =>
      (r.leftPlayer || '').toLowerCase().includes(search) ||
      (r.rightPlayer || '').toLowerCase().includes(search) ||
      (r.leftAlliance || '').toLowerCase().includes(search) ||
      (r.rightAlliance || '').toLowerCase().includes(search) ||
      getTeamKey(r.leftGenerals).toLowerCase().includes(search) ||
      getTeamKey(r.rightGenerals).toLowerCase().includes(search)
    );
  }
  if (filterR) data = data.filter(r => r.result === filterR);
  data.sort((a, b) => (b.id || 0) - (a.id || 0));
  return data;
}

function renderDataTable() {
  const data = getFilteredData();
  const total = data.length;
  const totalPages = Math.ceil(total / DATA_PER_PAGE);
  if (dataPage > totalPages) dataPage = Math.max(1, totalPages);
  const start = (dataPage - 1) * DATA_PER_PAGE;
  const page = data.slice(start, start + DATA_PER_PAGE);
  const tbody = document.getElementById('dataTableBody');
  if (!tbody) return;
  if (page.length === 0) {
    tbody.innerHTML = '<tr><td colspan="21" style="text-align:center;padding:30px;color:var(--text3);">暂无数据</td></tr>';
  } else {
    tbody.innerHTML = page.map((r, i) => `
      <tr>
        <td class="num">${start + i + 1}</td>
        <td style="color:var(--text2);font-size:11px;">${r.time || '-'}</td>
        <td><span class="result-badge result-${r.result === '胜' ? 'win' : r.result === '败' ? 'lose' : 'draw'}">${r.result || '-'}</span></td>
        <td style="white-space:nowrap;">${escHtml(r.leftPlayer || '')}</td>
        <td style="color:var(--text2);white-space:nowrap;min-width:110px;">${escHtml(r.leftAlliance || '')}</td>
        <td style="white-space:nowrap;min-width:80px;">${getTeamDisplay(r.leftGenerals)}</td>
        <td style="font-size:11px;line-height:1.6;min-width:300px;">${getTacticsDisplay(r.leftGenerals, r.leftTactics)}</td>
        <td style="color:var(--text2);">${escHtml(r.leftFormation || '')}</td>
        <td class="num">${fmtNum(r.leftLoss)}</td>
        <td class="num">${fmtNum(r.leftTotal)}</td>
        <td class="num" style="font-weight:bold;color:${getLossColor(r.leftLossRate)}">${r.leftLossRate != null ? r.leftLossRate.toFixed(1) + '%' : '-'}</td>
        <td style="white-space:nowrap;">${escHtml(r.rightPlayer || '')}</td>
        <td style="color:var(--text2);white-space:nowrap;min-width:110px;">${escHtml(r.rightAlliance || '')}</td>
        <td style="white-space:nowrap;min-width:80px;">${getTeamDisplay(r.rightGenerals)}</td>
        <td style="font-size:11px;line-height:1.6;min-width:300px;">${getTacticsDisplay(r.rightGenerals, r.rightTactics)}</td>
        <td style="color:var(--text2);">${escHtml(r.rightFormation || '')}</td>
        <td class="num">${fmtNum(r.rightLoss)}</td>
        <td class="num">${fmtNum(r.rightTotal)}</td>
        <td class="num" style="font-weight:bold;color:${getLossColor(r.rightLossRate)}">${r.rightLossRate != null ? r.rightLossRate.toFixed(1) + '%' : '-'}</td>
        <td>${r.imageBase64 ? `<a href="javascript:void(0)" onclick="showRecordImage(${r.id})" style="color:var(--accent);text-decoration:underline;font-size:12px;">🖼️ 原图</a>` : '<span style="color:var(--text3);font-size:11px;">无</span>'}</td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteRecord(${r.id})">删除</button></td>
      </tr>`).join('');
  }
  const pagEl = document.getElementById('dataPagination');
  if (pagEl) {
    if (totalPages <= 1) pagEl.innerHTML = '';
    else pagEl.innerHTML = `
      <button ${dataPage <= 1 ? 'disabled' : ''} onclick="dataPage--;renderDataTable()">◀</button>
      <span style="color:var(--text2);font-size:11px;">${dataPage}/${totalPages}</span>
      <button ${dataPage >= totalPages ? 'disabled' : ''} onclick="dataPage++;renderDataTable()">▶</button>`;
  }
}

async function showRecordImage(id) {
  const record = await dbGet(id);
  if (!record || !record.imageBase64) { alert('该记录没有保存原图'); return; }
  const m = document.createElement('div');
  m.className = 'image-modal';
  m.onclick = () => m.remove();
  m.innerHTML = `<img src="${record.imageBase64}" style="max-width:90vw;max-height:90vh;border-radius:8px;">`;
  document.body.appendChild(m);
}

async function deleteRecord(id) {
  if (!confirm('确定删除？')) return;
  // 先获取记录，找到所属项目
  const rec = allRecords.find(r => r.id === id);
  const projId = rec ? rec.projectId : null;

  // 如果记录属于某个项目，先从项目的 battleRecordIds 中移除
  if (projId) {
    try {
      const proj = await projDBGet(projId);
      if (proj && proj.battleRecordIds) {
        proj.battleRecordIds = proj.battleRecordIds.filter(rid => rid != id); // eslint-disable-line eqeqeq
        await projDBPut(proj);
      }
    } catch (e) {
      console.warn('[deleteRecord] 更新项目 battleRecordIds 失败:', e);
    }
  }

  // 删除战报记录
  await dbDelete(id);
  // 记录系统日志
  if (typeof addSysLog === 'function') {
    addSysLog('delete', '删除战报: ' + (rec ? (rec.leftPlayer || rec.rightPlayer || 'ID:' + id) : 'ID:' + id) + (projId ? ' [项目ID:' + projId + ']' : ''));
  }
  await loadAllRecords();
  renderDataTable();
}

async function clearAllData() {
  if (!confirm('确定清空所有数据？')) return;
  // 同时清空所有项目的 battleRecordIds
  try {
    const projects = await projDBGetAll();
    for (const proj of projects) {
      proj.battleRecordIds = [];
      await projDBPut(proj);
    }
  } catch (e) {
    console.warn('[clearAllData] 清空项目 battleRecordIds 失败:', e);
  }
  await dbClear();
  allRecords = [];
  updateGlobalStats();
  renderDataTable();
  renderGallery();
  location.reload();
}

// ========== CSV 导出 ==========
function downloadCSV(headers, rows, filename) {
  const BOM = '\uFEFF';
  const csv = BOM + headers.join(',') + '\n' + rows.map(r => r.map(c => '"' + String(c || '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  } catch (e) {
    console.error('downloadCSV error:', e);
    openCSVWindow(csv, filename);
  }
}

function openCSVWindow(csv, filename) {
  const w = window.open('', '_blank');
  if (!w) { alert('请允许弹出窗口以导出CSV'); return; }
  w.document.write('<html><head><title>' + filename + '</title></head><body><pre>' + csv.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre><p style="color:#666;font-size:12px;">按 Ctrl+S 保存此文件，文件名改为: ' + filename + '</p></body></html>');
  w.document.close();
}

function exportDataCSV() {
  try {
    const data = getFilteredData();
    if (data.length === 0) { alert('当前筛选条件下没有数据'); return; }
    // 记录系统日志
    if (typeof addSysLog === 'function') {
      addSysLog('operation', '导出战报数据CSV: ' + data.length + ' 条' + (window.currentProjectId ? ' [项目ID:' + window.currentProjectId + ']' : ''));
    }
    const headers = ['序号', '时间', '结果', '左侧玩家', '左侧同盟', '左侧武将', '左侧战法', '左侧阵型', '左侧战损', '左侧总兵力', '左侧战损率', '右侧玩家', '右侧同盟', '右侧武将', '右侧战法', '右侧阵型', '右侧战损', '右侧总兵力', '右侧战损率'];
    function tacStr(generals, tactics) {
      if (!generals || generals.length === 0) return '-';
      return generals.slice(0, 3).map((g, i) => {
        const base = i * 3;
        const t = [tactics?.[base] || '', tactics?.[base + 1] || '', tactics?.[base + 2] || ''].filter(t => t && t !== '未知');
        return g + (t.length ? '[' + t.join('/') + ']' : '');
      }).join(' | ');
    }
    const rows = data.map((r, i) => [
      i + 1,
      r.time || '',
      r.result || '',
      r.leftPlayer || '',
      r.leftAlliance || '',
      getTeamKey(r.leftGenerals),
      tacStr(r.leftGenerals, r.leftTactics),
      r.leftFormation || '',
      r.leftLoss || 0,
      r.leftTotal || 0,
      r.leftLossRate != null ? r.leftLossRate.toFixed(1) + '%' : '-',
      r.rightPlayer || '',
      r.rightAlliance || '',
      getTeamKey(r.rightGenerals),
      tacStr(r.rightGenerals, r.rightTactics),
      r.rightFormation || '',
      r.rightLoss || 0,
      r.rightTotal || 0,
      r.rightLossRate != null ? r.rightLossRate.toFixed(1) + '%' : '-'
    ]);
    downloadCSV(headers, rows, '三谋战报数据.csv');
  } catch (e) {
    console.error('exportDataCSV error:', e);
    alert('导出失败: ' + e.message);
    openCSVWindowFallback();
  }
}

function openCSVWindowFallback() {
  try {
    let data = getFilteredData();
    let csv = '\uFEFF';
    csv += '序号,时间,结果,左侧玩家,左侧同盟,左侧武将,左侧战法,左阵型,左战损,左总兵力,左战损率,右侧玩家,右侧同盟,右侧武将,右侧战法,右阵型,右战损,右总兵力,右战损率\n';
    data.forEach((r, i) => {
      function ts(g, t) {
        if (!g || !g.length) return '-';
        return g.slice(0, 3).map((gn, gi) => {
          const b = gi * 3;
          const tc = [t?.[b] || '', t?.[b + 1] || '', t?.[b + 2] || ''].filter(x => x && x !== '未知');
          return gn + (tc.length ? '[' + tc.join('/') + ']' : '');
        }).join(' | ');
      }
      csv += `${i + 1},"${r.time || ''}","${r.result || ''}","${r.leftPlayer || ''}","${r.leftAlliance || ''}","${getTeamKey(r.leftGenerals)}","${ts(r.leftGenerals, r.leftTactics)}","${r.leftFormation || ''}",${r.leftLoss || 0},${r.leftTotal || 0},"${r.leftLossRate != null ? r.leftLossRate.toFixed(1) + '%' : '-'}","${r.rightPlayer || ''}","${r.rightAlliance || ''}","${getTeamKey(r.rightGenerals)}","${ts(r.rightGenerals, r.rightTactics)}","${r.rightFormation || ''}",${r.rightLoss || 0},${r.rightTotal || 0},"${r.rightLossRate != null ? r.rightLossRate.toFixed(1) + '%' : '-'}"\n`;
    });
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<html><head><meta charset="utf-8"><title>三谋战报数据</title><style>body{font-family:monospace;padding:20px;font-size:12px;}pre{background:#f5f5f5;padding:15px;border-radius:5px;overflow-x:auto;}</style></head><body><h3>三谋战报数据 - 按 Ctrl+S 保存，文件名改为 .csv</h3><pre>' + csv.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre></body></html>');
      w.document.close();
    } else {
      alert('弹窗被阻止，请允许弹窗后重试');
    }
  } catch (e) {
    alert('导出完全失败: ' + e.message);
  }
}

// ========== GALLERY ==========
function renderGallery() {
  const container = document.getElementById('imageGallery');
  const empty = document.getElementById('galleryEmpty');
  const countEl = document.getElementById('galleryCount');
  const search = (document.getElementById('gallerySearch')?.value || '').toLowerCase();
  const filter = document.getElementById('galleryFilter')?.value || '';
  let records = allRecords.filter(r => r.imageBase64);
  if (search) records = records.filter(r => r.imageName && r.imageName.toLowerCase().includes(search));
  if (filter === 'parsed') records = records.filter(r => r.leftGenerals && r.leftGenerals.length > 0);
  if (filter === 'pending') records = records.filter(r => (!r.leftGenerals || r.leftGenerals.length === 0) && (!r.rightGenerals || r.rightGenerals.length === 0));
  if (filter === 'error') records = records.filter(r => r._parseError);
  if (countEl) countEl.textContent = records.length + ' 张';
  if (empty) empty.style.display = records.length > 0 ? 'none' : 'block';
  if (container) container.style.display = records.length > 0 ? 'flex' : 'none';
  records.sort((a, b) => (b.id || 0) - (a.id || 0));
  try {
    if (container) container.innerHTML = records.map(r => {
      const isParsed = (r.leftGenerals && r.leftGenerals.length > 0) || (r.rightGenerals && r.rightGenerals.length > 0);
      const isErr = r._parseError;
      const isChecked = gallerySelectedIds.has(r.id);
      const badgeCls = isErr ? 'badge-error' : isParsed ? 'badge-parsed' : 'badge-pending';
      const badgeText = isErr ? '失败' : isParsed ? '已解析' : '待处理';
      return `<div class="gallery-item" data-id="${r.id}"><div style="position:relative;"><div style="position:absolute;top:5px;right:5px;z-index:5;"><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleGalleryItem(${r.id},this.checked)" style="accent-color:var(--accent);width:16px;height:16px;cursor:pointer;"></div><img src="${r.imageBase64}" alt="${escHtml(r.imageName || '战报')}" style="width:180px;height:120px;object-fit:cover;border-radius:8px;cursor:pointer;" onclick="viewFullImageByRecord(${r.id})"><span class="gallery-badge ${badgeCls}">${badgeText}</span></div><div style="margin-top:4px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--text2);" title="${escHtml(r.imageName || '')}">${escHtml(r.imageName || '战报')}</div></div>`;
    }).join('');
    window.__galleryRecords = records;
    updateGallerySelectionUI();
  } catch (e) {
    if (container) container.innerHTML = `<div style="color:#e74c3c;padding:20px;">⚠️ 渲染异常：${e.message}</div>`;
    if (empty) { empty.style.display = 'none'; }
    if (container) container.style.display = 'block';
  }
}

function toggleGalleryItem(id, checked) {
  if (checked) gallerySelectedIds.add(id);
  else gallerySelectedIds.delete(id);
  updateGallerySelectionUI();
}

function toggleGallerySelectAll() {
  const sa = document.getElementById('gallerySelectAll')?.checked;
  const records = window.__galleryRecords || [];
  if (sa) records.forEach(r => gallerySelectedIds.add(r.id));
  else gallerySelectedIds.clear();
  document.querySelectorAll('.gallery-item input[type="checkbox"]').forEach(cb => {
    const item = cb.closest('.gallery-item');
    const id = parseInt(item?.dataset?.id);
    cb.checked = sa || gallerySelectedIds.has(id);
  });
  updateGallerySelectionUI();
}

function updateGallerySelectionUI() {
  const count = gallerySelectedIds.size;
  const el = document.getElementById('selectedCount');
  const btn = document.getElementById('btnBatchDelete');
  if (el) el.textContent = count;
  if (btn) btn.disabled = count === 0;
}

async function batchDeleteGallery() {
  const ids = [...gallerySelectedIds];
  if (ids.length === 0) return;
  if (!confirm(`确定删除 ${ids.length} 张图片？`)) return;
  for (const id of ids) { try { await dbDelete(id); } catch (e) { } }
  gallerySelectedIds.clear();
  await loadAllRecords();
  renderDataTable();
  renderGallery();
}

function viewFullImageByRecord(id) {
  const r = allRecords.find(r => r.id === id);
  if (!r || !r.imageBase64) return;
  const m = document.createElement('div');
  m.className = 'image-modal';
  m.onclick = () => m.remove();
  m.innerHTML = `<img src="${r.imageBase64}" style="max-width:90vw;max-height:90vh;border-radius:8px;">`;
  document.body.appendChild(m);
}

// ========== 数据模块初始化（供 appInit 调用） ==========
async function dataInit() {
  await openDB();
  await loadAllRecords();
  renderDataTable();
  renderGallery();
  console.log('[DataSystem] 初始化完成，当前 allRecords:', allRecords.length);
}

/* ==========================================================
   DATA SYSTEM - 战报数据管理（IndexDB 操作 + 表格渲染）
   ========================================================== */

// ========== 全局状态 ==========
let db = null;
let allRecords = [];
let batchRunning = false;
let dataPage = 1;
let dataPerPage = 10;  // 减少到10条，降低渲染压力
let winRateSortField = null;
let winRateSortDir = 'desc';
let gallerySelectedIds = new Set();
let cachedWinRateData = [];
let _dupFilterActive = false;
let _dupSelectIds = new Set(); // 预选待删除的重复记录ID

// ========== 武将/战法独立字段 helper ==========
function getGenerals(rec, side) {
  const p = side === 'left' ? 'leftGeneral' : 'rightGeneral';
  return [rec[p + '1'] || '', rec[p + '2'] || '', rec[p + '3'] || ''];
}

function getTactics(rec, side) {
  const p = side === 'left' ? 'leftTactic' : 'rightTactic';
  return [
    rec[p + '1_1'] || '', rec[p + '1_2'] || '', rec[p + '1_3'] || '',
    rec[p + '2_1'] || '', rec[p + '2_2'] || '', rec[p + '2_3'] || '',
    rec[p + '3_1'] || '', rec[p + '3_2'] || '', rec[p + '3_3'] || ''
  ];
}

function setFlat(rec, side, generals, tactics) {
  const gp = side === 'left' ? 'leftGeneral' : 'rightGeneral';
  const tp = side === 'left' ? 'leftTactic'  : 'rightTactic';
  rec[gp + '1'] = generals[0] || ''; rec[gp + '2'] = generals[1] || ''; rec[gp + '3'] = generals[2] || '';
  rec[tp + '1_1'] = tactics[0] || ''; rec[tp + '1_2'] = tactics[1] || ''; rec[tp + '1_3'] = tactics[2] || '';
  rec[tp + '2_1'] = tactics[3] || ''; rec[tp + '2_2'] = tactics[4] || ''; rec[tp + '2_3'] = tactics[5] || '';
  rec[tp + '3_1'] = tactics[6] || ''; rec[tp + '3_2'] = tactics[7] || ''; rec[tp + '3_3'] = tactics[8] || '';
}

// ========== IndexedDB ==========
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('SanmoBattleDB', 5); // v5: 战法 _1/_2/_3 三字段（v4→v5 平移 _2→_1, _3→_2）
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      // v1: records
      if (!d.objectStoreNames.contains('records'))
        d.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      // v4: 迁移旧数组字段为独立字段
      if (e.oldVersion < 4) {
        const tx = e.target.transaction;
        const store = tx.objectStore('records');
        store.openCursor().onsuccess = function(ev) {
          const cursor = ev.target.result;
          if (!cursor) return;
          const rec = cursor.value;
          let changed = false;
          if (rec.leftGenerals || rec.rightGenerals || rec.leftTactics || rec.rightTactics) {
            setFlat(rec, 'left',  rec.leftGenerals  || [], rec.leftTactics  || []);
            setFlat(rec, 'right', rec.rightGenerals || [], rec.rightTactics || []);
            delete rec.leftGenerals; delete rec.rightGenerals;
            delete rec.leftTactics;  delete rec.rightTactics;
            changed = true;
          }
          if (changed) cursor.update(rec);
          cursor.continue();
        };
      }
      // v5: 战法字段平移 _2→_1, _3→_2, 新增 _3=空（配合后端 tactics 9元组加入 slot1）
      if (e.oldVersion < 5 && e.oldVersion >= 4) {
        const tx = e.target.transaction;
        const store = tx.objectStore('records');
        store.openCursor().onsuccess = function(ev) {
          const cursor = ev.target.result;
          if (!cursor) return;
          const rec = cursor.value;
          let changed = false;
          ['leftTactic', 'rightTactic'].forEach(tp => {
            for (let hi = 1; hi <= 3; hi++) {
              const key1 = tp + hi + '_1';
              const key2 = tp + hi + '_2';
              const key3 = tp + hi + '_3';
              // 仅当 _1 为空且 _2 或 _3 有值时平移（避免覆盖已纠正的记录）
              if (!rec[key1] && (rec[key2] || rec[key3])) {
                rec[key1] = rec[key2] || '';  // old _2 → new _1
                rec[key2] = rec[key3] || '';  // old _3 → new _2
                rec[key3] = '';                // new _3 empty
                changed = true;
              }
            }
          });
          if (changed) cursor.update(rec);
          cursor.continue();
        };
      }
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
    rec.battleDate = rec.battleDate || new Date().toISOString().split('T')[0];
    rec.hasImage = !!(rec.imageBase64);
    const req = store.add(rec);
    req.onsuccess = () => {
      rec.id = req.result;
      // 推入 allRecords 不含 imageBase64（节省内存，按需从 IndexedDB 读取）
      const { imageBase64: _img, ...liteRec } = rec;
      allRecords.push({ ...liteRec });
      updateGlobalStats();
      syncToLocalStorage();
      renderDataTable();
      
      // 同步到云端
      console.log('[dbAdd] window.cloudSync 存在?', !!window.cloudSync, '| createRecord 类型:', typeof window?.cloudSync?.createRecord);
      if(window.cloudSync){
        try{
          const cloudRec = {
            projectId: rec.projectId || window.currentProjectId || null,
            battleDate: (rec.battleDate || (rec.imageTime ? new Date(rec.imageTime).toISOString() : new Date().toISOString())).split('T')[0],
            attackerName: rec.leftPlayer || rec.attackerName || '',
            enemyName: rec.rightPlayer || rec.enemyName || '',
            leftAlliance: rec.leftAlliance || '',
            rightAlliance: rec.rightAlliance || '',
            leftFormation: rec.leftFormation || '',
            rightFormation: rec.rightFormation || '',
            leftGeneral1: rec.leftGeneral1 || '', leftGeneral2: rec.leftGeneral2 || '', leftGeneral3: rec.leftGeneral3 || '',
            rightGeneral1: rec.rightGeneral1 || '', rightGeneral2: rec.rightGeneral2 || '', rightGeneral3: rec.rightGeneral3 || '',
            leftGeneral1Stars: rec.leftGeneral1Stars ?? 0, leftGeneral2Stars: rec.leftGeneral2Stars ?? 0, leftGeneral3Stars: rec.leftGeneral3Stars ?? 0,
            rightGeneral1Stars: rec.rightGeneral1Stars ?? 0, rightGeneral2Stars: rec.rightGeneral2Stars ?? 0, rightGeneral3Stars: rec.rightGeneral3Stars ?? 0,
            leftTactic1_1: rec.leftTactic1_1||'', leftTactic1_2: rec.leftTactic1_2||'', leftTactic1_3: rec.leftTactic1_3||'',
            leftTactic2_1: rec.leftTactic2_1||'', leftTactic2_2: rec.leftTactic2_2||'', leftTactic2_3: rec.leftTactic2_3||'',
            leftTactic3_1: rec.leftTactic3_1||'', leftTactic3_2: rec.leftTactic3_2||'', leftTactic3_3: rec.leftTactic3_3||'',
            rightTactic1_1: rec.rightTactic1_1||'', rightTactic1_2: rec.rightTactic1_2||'', rightTactic1_3: rec.rightTactic1_3||'',
            rightTactic2_1: rec.rightTactic2_1||'', rightTactic2_2: rec.rightTactic2_2||'', rightTactic2_3: rec.rightTactic2_3||'',
            rightTactic3_1: rec.rightTactic3_1||'', rightTactic3_2: rec.rightTactic3_2||'', rightTactic3_3: rec.rightTactic3_3||'',
            leftLoss: rec.leftLoss ?? null,
            rightLoss: rec.rightLoss ?? null,
            leftTotal: rec.leftTotal ?? null,
            rightTotal: rec.rightTotal ?? null,
            leftLossRate: rec.leftLossRate ?? null,
            rightLossRate: rec.rightLossRate ?? null,
            result: rec.result || '',
            description: rec.description || '',
            imageBase64: rec.imageBase64 || '',
            imageName: rec.imageName || '',
            uploaderPhone: rec.user_phone || (typeof currentUser !== 'undefined' ? currentUser.phone : '')
          };
          console.log('[dbAdd] 准备调用 cloudSync.createRecord, cloudRec:', JSON.stringify(cloudRec).slice(0,200));
          window.cloudSync.createRecord(cloudRec).then(result => {
            if(result && result.id){
              console.log('[Cloud] 战报已同步到云端:', result.id);
              rec.cloudId = result.id;
              rec._cloudSynced = true;
              // 只写回本地 IndexedDB，不再触发云端 updateRecord
              dbPutLocal(rec);
            }
          }).catch(e => console.error('[Cloud] 战报同步失败:', e));
        }catch(e){console.error('[Cloud] 战报同步异常:', e);}
      } else {
        console.warn('[dbAdd] window.cloudSync 不可用，跳过云端同步');
      }

      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

// 仅写 IndexedDB，不同步云端（用于写回 cloudId 等元信息）
function dbPutLocal(rec) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').put(rec);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 批量写入 IndexedDB（单个事务），用于云同步等大批量写入场景
function dbPutAllLocal(records) {
  return new Promise((resolve, reject) => {
    if (!records || records.length === 0) return resolve(0);
    const tx = db.transaction(['records'], 'readwrite');
    const store = tx.objectStore('records');
    let count = 0;
    for (const rec of records) {
      store.put(rec);
      count++;
    }
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

// 仅添加到本地 IndexedDB，不触发云端同步（用于服务端已存 MySQL 的记录，如 ocr-upload）
async function dbAddLocal(rec) {
  if (!db) await openDB();
  rec.projectId = rec.projectId || window.currentProjectId || '';
  rec.user_phone = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.phone : '';
  rec.time = rec.time || new Date().toLocaleString('zh-CN');
  rec.battleDate = rec.battleDate || new Date().toISOString().split('T')[0];
  rec.hasImage = !!(rec.imageBase64);

  // 用 put 代替 add：有则更新，无则插入，不因主键冲突静默失败
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').put(rec);
    req.onsuccess = () => { rec.id = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });

  // 更新内存（去掉图片字段节省内存）
  const { imageBase64: _, ...liteRec } = rec;
  const idx = allRecords.findIndex(r => r.id === rec.id);
  if (idx >= 0) allRecords[idx] = { ...liteRec };
  else allRecords.push({ ...liteRec });

  updateGlobalStats();
  syncToLocalStorage();
  dataPage = 1;        // 新记录排在最前，跳回第 1 页
  renderDataTable();
  return rec.id;
}
window.dbAddLocal = dbAddLocal;

// 仅删 IndexedDB，不同步云端（用于同步时清理本地孤立记录）
function dbDeleteLocal(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(rec) {
  // 1. MySQL first：有 cloudId 则先更新云端
  const cloudRecordId = rec.cloudId;
  if (window.cloudSync && cloudRecordId) {
    const ok = await window.cloudSync.updateRecord(cloudRecordId, rec);
    if (!ok) throw new Error('云端更新失败，操作已取消');
  }

  // 2. MySQL 成功后，写入 IndexedDB
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').put(rec);
    req.onsuccess = () => resolve(rec.id);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    if (!db) { resolve([]); return; }
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

// 轻量版 getAll：跳过 imageBase64，设 hasImage 标记，大幅减少内存占用
// 🔥 支持按项目过滤，避免加载所有数据
function dbGetAllLite(projectId = null) {
  return new Promise((resolve, reject) => {
    if (!db) { resolve([]); return; }
    const tx = db.transaction(['records'], 'readonly');
    const results = [];

    // 如果指定了项目ID，使用索引查询
    let req;
    if (projectId) {
      const store = tx.objectStore('records');
      // 尝试使用索引查询（如果有的话）
      try {
        const index = store.index('projectId');
        req = index.openCursor(IDBKeyRange.only(String(projectId)));
      } catch (e) {
        // 如果没有索引，使用全表扫描
        console.warn('[dbGetAllLite] 项目索引不存在，使用全表扫描');
        req = store.openCursor();
      }
    } else {
      req = tx.objectStore('records').openCursor();
    }

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) { resolve(results); return; }
      const val = cursor.value;

      // 如果指定了项目ID且使用全表扫描，需要过滤
      if (projectId && String(val.projectId) !== String(projectId)) {
        cursor.continue();
        return;
      }

      if (val.imageBase64) {
        const { imageBase64, ...lite } = val;
        results.push({ ...lite, hasImage: true });
      } else {
        results.push(val);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  // 1. 从内存取 cloudId
  const rec = allRecords.find(r => r.id === id);
  const cloudId = rec?.cloudId || rec?.cloud_id || id;

  // 2. MySQL first：优先删云端，失败直接抛出（不动本地）
  if (window.cloudSync && window.cloudSync.deleteRecord && cloudId) {
    const ok = await window.cloudSync.deleteRecord(cloudId);
    if (!ok) throw new Error('云端删除失败，操作已取消');
  }

  // 3. MySQL 删除成功后，再删 IndexedDB
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const req = tx.objectStore('records').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // 4. 更新内存和视图
  allRecords = allRecords.filter(r => r.id !== id);
  gallerySelectedIds.delete(id);
  updateGlobalStats();
  renderDataTable();
  renderGallery();
  syncToLocalStorage();
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
  if (!db && typeof openDB === 'function') await openDB();
  console.log('[loadAllRecords] 开始加载...');
  const startTime = performance.now();
  try {
    // 🔥 核心优化：只加载当前项目的数据
    const currentProjectId = window.currentProjectId;

    let records;
    if (currentProjectId) {
      // 有项目过滤：直接从 IndexedDB 查询该项目的数据
      records = await dbGetAllLite(currentProjectId);
      console.log('[loadAllRecords] 从 IndexedDB 加载项目', currentProjectId, '的数据，共', records.length, '条，耗时', Math.round(performance.now() - startTime), 'ms');
      allRecords = records;
    } else {
      // 无项目过滤：加载所有数据（限制1000条）
      records = await dbGetAllLite();
      const totalRecords = records.length;
      console.log('[loadAllRecords] 从 IndexedDB 读取了', totalRecords, '条记录，耗时', Math.round(performance.now() - startTime), 'ms');

      // 如果数据量过大，只保留最新的记录
      const MAX_RECORDS = 1000;
      if (records.length > MAX_RECORDS) {
        console.warn(`[loadAllRecords] 数据量过大 (${records.length}条)，只加载最新的 ${MAX_RECORDS} 条`);
        records.sort((a, b) => (b.id || 0) - (a.id || 0));
        records = records.slice(0, MAX_RECORDS);
      }

      // 按权限过滤
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'super_admin') {
        let visibleProjIds = new Set();
        try {
          const visProjs = await (typeof getVisibleProjects === 'function' ? getVisibleProjects({ cacheOnly: true }) : Promise.resolve([]));
          visProjs.forEach(p => visibleProjIds.add(String(p.id)));
        } catch(e) {}
        allRecords = records.filter(r =>
          !r.projectId || visibleProjIds.has(String(r.projectId))
        );
      } else {
        allRecords = records;
      }

      if (totalRecords > MAX_RECORDS) {
        console.warn(`⚠️ IndexedDB 中有 ${totalRecords} 条记录，建议清理旧数据`);
      }
    }

    console.log('[loadAllRecords] 最终加载', allRecords.length, '条记录，总耗时', Math.round(performance.now() - startTime), 'ms');
  } catch (e) {
    console.error('[loadAllRecords] 加载失败:', e);
    allRecords = [];
  }

  // 健壮性：如果 currentProjectId 指向一个已删除的项目，自动清除过滤
  if (window.currentProjectId) {
    try {
      const proj = await projDBGet(window.currentProjectId);
      if (!proj) {
        console.warn('[loadAllRecords] 当前项目不存在（可能已被删除），自动清除过滤');
        window.currentProjectId = null;
        if (typeof renderProjectSwitcher === 'function') renderProjectSwitcher();
        // 重新过滤（不过滤）
        const all = await dbGetAll();
        allRecords = all;
      }
    } catch (e) {}
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
            try { await dbPutLocal(rec); } catch (e) { } // 只写本地，不推云端
          }
          allRecords = await dbGetAll();
          if (window.currentProjectId) {
            const pidStr = String(window.currentProjectId);
            allRecords = allRecords.filter(r => String(r.projectId) === pidStr);
          }
        }
      } catch (e) { }
    }
  }
  window.allRecords = allRecords;
  updateGlobalStats();
}

// 修复历史数据：将本地 IndexedDB 中有武将/战法数据但云端为空的记录重新推送
async function repairCloudGeneralsTactics() {
  if (!window.cloudSync || !window.cloudSync.updateRecord) {
    alert('云端同步不可用，无法修复'); return;
  }
  if (!db) await openDB();
  const localRecords = await dbGetAll();
  const toFix = localRecords.filter(r => {
    if (!r.cloudId) return false;
    return r.leftGeneral1 || r.leftGeneral2 || r.leftGeneral3 ||
           r.rightGeneral1 || r.rightGeneral2 || r.rightGeneral3;
  });
  if (toFix.length === 0) { alert('没有需要修复的记录（本地无武将数据）'); return; }
  const confirmed = confirm(`发现 ${toFix.length} 条本地有武将数据的记录，将重新同步至云端。继续？`);
  if (!confirmed) return;
  let ok = 0, fail = 0;
  for (const r of toFix) {
    try {
      await window.cloudSync.updateRecord(r.cloudId, r);
      ok++;
    } catch (e) {
      fail++;
      console.warn('[repair] 更新失败 cloudId=' + r.cloudId, e);
    }
  }
  alert(`修复完成：成功 ${ok} 条，失败 ${fail} 条`);
  if (ok > 0 && typeof renderDataTable === 'function') renderDataTable();
}

function syncToLocalStorage() {
  // 🔥 禁用此功能，避免调用 dbGetAll() 导致内存溢出
  // localStorage 容量有限（5-10MB），不适合存储大量数据
  // allRecords 已经在内存中，不需要额外备份到 localStorage
  return;

  /* 原实现已禁用
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
  */
}

// ========== OCR STATUS ==========
function updateOcrStatus(status, text) {
  const dot = document.getElementById('ocrDot');
  const txt = document.getElementById('ocrText');
  if (dot) dot.className = 'ocr-dot ' + status;
  if (txt) txt.textContent = text;
}
updateOcrStatus('ok', 'OCR 就绪');

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
  try { localStorage.setItem('lastTab', tabId); } catch(e) {}

  // 先隐藏所有 tab-content（强制用 !important 等价于设置 inline style）
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.setProperty('display', 'none', 'important');
    el.classList.remove('active');
  });

  const tab = document.getElementById('tab-' + tabId);
  if (tab) {
    tab.style.setProperty('display', tabId === 'data' ? 'grid' : 'block', 'important');
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
  const SYS_TABS = ['user','syslog','datamgmt','rolemanage','dataperm','cloudservice','ocrdict','ocrpending','labeleditor'];
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
  if (tabId === 'ocrdict') { if (typeof onOcrDictTabShow === 'function') onOcrDictTabShow(); }
  if (tabId === 'ocrpending') { if (typeof onOcrPendingTabShow === 'function') onOcrPendingTabShow(); }
  if (tabId === 'labeleditor') { if (typeof onLabelEditorTabShow === 'function') onLabelEditorTabShow(); }
  if (tabId === 'project') {
    if (typeof renderProjectManage === 'function') renderProjectManage({ cacheOnly: true });
  }
  if (tabId === 'data') {
    renderDataTable();
    renderGallery();
    if (typeof renderOCRQueue === 'function') renderOCRQueue();
    if (typeof replaceOcrWatchPanel === 'function' && window.currentProjectId) replaceOcrWatchPanel();
    if (typeof loadPendingTasksFromBackend === 'function') loadPendingTasksFromBackend();
    if (typeof loadOcrWatchTask === 'function' && window.currentProjectId) loadOcrWatchTask(window.currentProjectId);
  }
  if (tabId === 'winrate') { const el = document.getElementById('tab-winrate'); if (el && typeof createCounterAnalysisUI === 'function') createCounterAnalysisUI(el).catch(e => console.error('[createCounterAnalysisUI] 失败:', e)); }
  if (tabId === 'library') { renderHeroes(); renderTactics(); }
  if (tabId === 'ranking') renderRanking();
  if (tabId === 'peijiang') onPeijiangChange();
  if (tabId === 'yanwu') onYanwuChange();
  if (tabId === 'project') { /* project list already rendered from cache above */ }
  if (tabId === 'user') { if(typeof renderUserManage==='function') renderUserManage(); }
  if (tabId === 'syslog') { if(typeof renderSysLog==='function') renderSysLog(); }
  if (tabId === 'rolemanage') { if(typeof renderRoleManage==='function') renderRoleManage(); }
  if (tabId === 'dataperm') {
    console.log('[switchTab] dataperm tab 激活，renderDataPerm 类型:', typeof renderDataPerm);
    if (typeof renderDataPerm === 'function') {
      renderDataPerm();
    } else {
      // 兜底：data-perm.js 可能还没加载或还在缓存
      console.warn('[switchTab] renderDataPerm 未定义，尝试动态加载 data-perm.js...');
      const c = document.getElementById('dataPermContent');
      if (c) c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text2);">⏳ 加载中，请稍候...</div>';
      var s = document.createElement('script');
      s.src = 'data-perm.js?v=' + Date.now();
      s.onload = function() {
        console.log('[switchTab] data-perm.js 动态加载成功，renderDataPerm:', typeof renderDataPerm);
        if (typeof renderDataPerm === 'function') {
          // 用 setTimeout 确保脚本加载完成后上下文已就绪；同时加 12 秒全局兜底
          setTimeout(function() {
            try {
              var t = setTimeout(function() {
                console.error('[switchTab] renderDataPerm 12秒未完成，强制替换loading');
                if (c) c.innerHTML = '<div style="padding:40px;text-align:center;color:#ff5252;">⚠️ 加载超时，请刷新重试</div>';
              }, 12000);
              renderDataPerm();
              clearTimeout(t);
            } catch(e) {
              clearTimeout(t);
              console.error('[switchTab] renderDataPerm 执行异常:', e.message || e);
              if (c) c.innerHTML = '<div style="padding:40px;text-align:center;color:#ff5252;">❌ 加载异常：'+e.message+'</div>';
            }
          }, 0);
        } else {
          if (c) c.innerHTML = '<div style="padding:40px;text-align:center;color:#ff5252;">❌ 脚本加载失败（renderDataPerm未定义），请 Ctrl+Shift+R 刷新</div>';
        }
      };
      s.onerror = function() { if(c) c.innerHTML = '<div style="padding:40px;text-align:center;color:#ff5252;">❌ data-perm.js 加载失败，请 Ctrl+Shift+R 刷新</div>'; };
      document.head.appendChild(s);
    }
  }
  if (tabId === 'cloudservice') { if(typeof refreshDBUsage==='function') refreshDBUsage(); if(typeof refreshCloudStorageStats==='function') refreshCloudStorageStats(); if(typeof initDBViewer==='function') initDBViewer(); }
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

// ========== 云端服务：刷新云端数据库统计 ==========
async function refreshCloudStorageStats() {
  const container = document.getElementById('cloudStorageStats');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);">⏳ 加载中...</div>';

  try {
    let stats = null;
    if (window.cloudSync && window.cloudSync.getStorageStats) {
      stats = await window.cloudSync.getStorageStats();
    }

    if (!stats) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#ff5252;">❌ 无法获取云端统计数据</div>';
      return;
    }

    const formatSize = (kb) => {
      if (!kb || kb <= 0) return '0 KB';
      if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
      return kb + ' KB';
    };

    const updateTime = stats.collectedAt
      ? new Date(stats.collectedAt).toLocaleString('zh-CN')
      : '未知';

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">
        <div style="padding:12px;background:var(--bg3);border-radius:6px;">
          <div style="color:var(--text3);margin-bottom:4px;">📦 数据库记录</div>
          <div style="font-size:18px;font-weight:700;color:var(--accent);">${stats.dbRecords || 0}</div>
          <div style="color:var(--text3);font-size:10px;">条</div>
        </div>
        <div style="padding:12px;background:var(--bg3);border-radius:6px;">
          <div style="color:var(--text3);margin-bottom:4px;">💾 数据库大小</div>
          <div style="font-size:18px;font-weight:700;color:var(--accent);">${formatSize(stats.dbSizeKB || 0)}</div>
        </div>
        <div style="padding:12px;background:var(--bg3);border-radius:6px;">
          <div style="color:var(--text3);margin-bottom:4px;">📁 上传文件</div>
          <div style="font-size:18px;font-weight:700;color:var(--cyan);">${stats.uploadFiles || 0}</div>
          <div style="color:var(--text3);font-size:10px;">个</div>
        </div>
        <div style="padding:12px;background:var(--bg3);border-radius:6px;">
          <div style="color:var(--text3);margin-bottom:4px;">🗂️ 上传大小</div>
          <div style="font-size:18px;font-weight:700;color:var(--cyan);">${formatSize(stats.uploadSizeKB || 0)}</div>
        </div>
        <div style="padding:12px;background:var(--bg3);border-radius:6px;">
          <div style="color:var(--text3);margin-bottom:4px;">👥 活跃用户</div>
          <div style="font-size:18px;font-weight:700;color:var(--green);">${stats.activeUsers || 0}</div>
          <div style="color:var(--text3);font-size:10px;">人</div>
        </div>
        <div style="padding:12px;background:var(--bg3);border-radius:6px;">
          <div style="color:var(--text3);margin-bottom:4px;">⚔️ 战报数量</div>
          <div style="font-size:18px;font-weight:700;color:var(--green);">${stats.battlesCount || 0}</div>
          <div style="color:var(--text3);font-size:10px;">条</div>
        </div>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);text-align:center;">
        🔄 每10秒自动更新 · ${updateTime}
      </div>
    `;
  } catch (e) {
    console.error('[refreshCloudStorageStats] 失败:', e);
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#ff5252;">❌ 加载失败: ' + e.message + '</div>';
  }
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
    teams.add(getTeamKey(getGenerals(r, 'left')));
    teams.add(getTeamKey(getGenerals(r, 'right')));
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

function getStarsDisplay(rec, side) {
  const p = side === 'left' ? 'leftGeneral' : 'rightGeneral';
  const vals = [rec[p+'1Stars'], rec[p+'2Stars'], rec[p+'3Stars']];
  const hasAny = vals.some(v => v != null && v !== '');
  if (!hasAny) return '<span style="color:var(--text3);font-size:11px;">-<br>-<br>-</span>';
  return vals.map(v => {
    const n = v != null && v !== '' ? Number(v) : 0;
    return `<span style="font-size:11px;color:${n > 0 ? 'var(--accent)' : 'var(--text3)'};">${n}</span>`;
  }).join('<br>');
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
    html += `<div style="white-space:nowrap;"><span style="color:var(--text2);font-size:10px;">${parts.length ? parts.map(t => escHtml(t)).join(' / ') : '-'}</span></div>`;
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
// 数据底表排序状态
let dataSortField = null;
let dataSortDir = 'desc';

function getFilteredData() {
  let data = [...allRecords];
  const search = (document.getElementById('dataSearch')?.value || '').toLowerCase();
  const filterR = document.getElementById('dataFilterResult')?.value || '';
  const filterAlliance = (document.getElementById('dataFilterAlliance')?.value || '').toLowerCase();
  const filterGeneral = (document.getElementById('dataFilterGeneral')?.value || '').toLowerCase();
  const filterTactic = (document.getElementById('dataFilterTactic')?.value || '').toLowerCase();
  const filterFormation = (document.getElementById('dataFilterFormation')?.value || '').toLowerCase();

  if (search) {
    data = data.filter(r =>
      (r.leftPlayer || '').toLowerCase().includes(search) ||
      (r.rightPlayer || '').toLowerCase().includes(search) ||
      (r.leftAlliance || '').toLowerCase().includes(search) ||
      (r.rightAlliance || '').toLowerCase().includes(search) ||
      getTeamKey(getGenerals(r, 'left')).toLowerCase().includes(search) ||
      getTeamKey(getGenerals(r, 'right')).toLowerCase().includes(search)
    );
  }
  if (filterR) data = data.filter(r => r.result === filterR);

  // 同盟关键词筛选
  if (filterAlliance) {
    data = data.filter(r =>
      (r.leftAlliance || '').toLowerCase().includes(filterAlliance) ||
      (r.rightAlliance || '').toLowerCase().includes(filterAlliance)
    );
  }

  // 武将关键词筛选
  if (filterGeneral) {
    data = data.filter(r => {
      const leftGens = getTeamKey(getGenerals(r, 'left')).toLowerCase();
      const rightGens = getTeamKey(getGenerals(r, 'right')).toLowerCase();
      return leftGens.includes(filterGeneral) || rightGens.includes(filterGeneral);
    });
  }

  // 战法关键词筛选
  if (filterTactic) {
    data = data.filter(r => {
      const leftTacs = getTactics(r, 'left').join(',').toLowerCase();
      const rightTacs = getTactics(r, 'right').join(',').toLowerCase();
      return leftTacs.includes(filterTactic) || rightTacs.includes(filterTactic);
    });
  }

  // 阵型关键词筛选
  if (filterFormation) {
    data = data.filter(r =>
      (r.leftFormation || '').toLowerCase().includes(filterFormation) ||
      (r.rightFormation || '').toLowerCase().includes(filterFormation)
    );
  }

  // 重复战报筛选
  if (_dupFilterActive) {
    const dupGroups = getDuplicateGroups();
    const dupIdSet = new Set(dupGroups.flat().map(r => r.id));
    data = data.filter(r => dupIdSet.has(r.id));
  }

  // 排序逻辑
  if (dataSortField) {
    data.sort((a, b) => {
      let va, vb;
      switch (dataSortField) {
        case 'leftLoss': va = a.leftLoss || 0; vb = b.leftLoss || 0; break;
        case 'rightLoss': va = a.rightLoss || 0; vb = b.rightLoss || 0; break;
        case 'leftTotal': va = a.leftTotal || 0; vb = b.leftTotal || 0; break;
        case 'rightTotal': va = a.rightTotal || 0; vb = b.rightTotal || 0; break;
        case 'leftLossRate': va = a.leftLossRate || 0; vb = b.leftLossRate || 0; break;
        case 'rightLossRate': va = a.rightLossRate || 0; vb = b.rightLossRate || 0; break;
        default: va = a.id || 0; vb = b.id || 0;
      }
      return dataSortDir === 'asc' ? va - vb : vb - va;
    });
  } else {
    data.sort((a, b) => (b.id || 0) - (a.id || 0));
  }
  return data;
}

function renderDataTable() {
  const data = getFilteredData();
  const total = data.length;
  const totalPages = Math.ceil(total / dataPerPage);
  if (dataPage > totalPages) dataPage = Math.max(1, totalPages);
  const start = (dataPage - 1) * dataPerPage;
  const page = data.slice(start, start + dataPerPage);
  const tbody = document.getElementById('dataTableBody');
  if (!tbody) return;
  // 初始化表头排序指示器
  updateDataTableHeaders();
  if (page.length === 0) {
    tbody.innerHTML = '<tr><td colspan="26" style="text-align:center;padding:30px;color:var(--text3);">暂无数据</td></tr>';
  } else {
    tbody.innerHTML = page.map((r, i) => `
      <tr>
        <td style="width:32px;min-width:32px;text-align:center;padding:0;"><input type="checkbox" class="row-check" data-id="${r.id}" ${_dupSelectIds.has(r.id) ? 'checked' : ''} onchange="updateSelectionCount()" style="width:16px;height:16px;padding:0;margin:0;cursor:pointer;accent-color:var(--accent);"></td>
        <td class="num">${start + i + 1}</td>
        <td style="color:var(--text2);font-size:11px;">${r.time || '-'}</td>
        <td style="text-align:center;"><a href="javascript:void(0)" onclick="showRecordImage(${r.id})" style="color:var(--accent);text-decoration:underline;font-size:12px;" title="点击查看原图">🔍 原图</a></td>
        <td><span class="result-badge result-${r.result === '胜' ? 'win' : r.result === '败' ? 'lose' : 'draw'}">${r.result || '-'}</span></td>
        <td style="white-space:nowrap;">${escHtml(r.leftPlayer || '')}</td>
        <td style="color:var(--text2);white-space:nowrap;min-width:77px;">${escHtml(r.leftAlliance || '')}</td>
        <td style="white-space:nowrap;min-width:56px;">${getTeamDisplay(getGenerals(r, 'left'))}</td>
        <td style="min-width:28px;text-align:center;">${getStarsDisplay(r,'left')}</td>
        <td style="min-width:100px;">${getTacticColDisplay(r,'left',1)}</td>
        <td style="min-width:100px;">${getTacticColDisplay(r,'left',2)}</td>
        <td style="min-width:100px;">${getTacticColDisplay(r,'left',3)}</td>
        <td style="color:var(--text2);">${escHtml(r.leftFormation || '')}</td>
        <td class="num">${fmtNum(r.leftLoss)}</td>
        <td class="num">${fmtNum(r.leftTotal)}</td>
        <td class="num" style="font-weight:bold;color:${getLossColor(r.leftLossRate)}">${r.leftLossRate != null ? Number(r.leftLossRate).toFixed(1) + '%' : '-'}</td>
        <td style="white-space:nowrap;">${escHtml(r.rightPlayer || '')}</td>
        <td style="color:var(--text2);white-space:nowrap;min-width:77px;">${escHtml(r.rightAlliance || '')}</td>
        <td style="white-space:nowrap;min-width:56px;">${getTeamDisplay(getGenerals(r, 'right'))}</td>
        <td style="min-width:28px;text-align:center;">${getStarsDisplay(r,'right')}</td>
        <td style="min-width:100px;">${getTacticColDisplay(r,'right',1)}</td>
        <td style="min-width:100px;">${getTacticColDisplay(r,'right',2)}</td>
        <td style="min-width:100px;">${getTacticColDisplay(r,'right',3)}</td>
        <td style="color:var(--text2);">${escHtml(r.rightFormation || '')}</td>
        <td class="num">${fmtNum(r.rightLoss)}</td>
        <td class="num">${fmtNum(r.rightTotal)}</td>
        <td class="num" style="font-weight:bold;color:${getLossColor(r.rightLossRate)}">${r.rightLossRate != null ? Number(r.rightLossRate).toFixed(1) + '%' : '-'}</td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteRecord(${r.id})">删除</button></td>
      </tr>`).join('');
  }
  const pagEl = document.getElementById('dataPagination');
  if (pagEl) {
    const sizeSelect = `<select onchange="dataPerPage=+this.value;dataPage=1;renderDataTable()" style="font-size:11px;padding:2px 4px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);border-radius:4px;cursor:pointer;">
      ${[10,20,30,50,100].map(n=>`<option value="${n}"${n===dataPerPage?' selected':''}>${n}条/页</option>`).join('')}
    </select>`;
    if (totalPages <= 1) pagEl.innerHTML = sizeSelect;
    else pagEl.innerHTML = `
      ${sizeSelect}
      <button ${dataPage <= 1 ? 'disabled' : ''} onclick="dataPage--;renderDataTable()">◀</button>
      <span style="color:var(--text2);font-size:11px;">${dataPage}/${totalPages}</span>
      <button ${dataPage >= totalPages ? 'disabled' : ''} onclick="dataPage++;renderDataTable()">▶</button>`;
  }
}

// ── 批量勾选 ─────────────────────────────────────────────────────────
function updateSelectionCount() {
  const n = document.querySelectorAll('#dataTableBody .row-check:checked').length;
  const span = document.getElementById('dataSelectedCount');
  const btn  = document.getElementById('btnDeleteSelected');
  if (span) span.textContent = n;
  if (btn)  { btn.disabled = n === 0; btn.style.opacity = n > 0 ? '1' : '.4'; btn.style.cursor = n > 0 ? 'pointer' : 'not-allowed'; }
}
function tableCheckAll(chk) {
  document.querySelectorAll('#dataTableBody .row-check').forEach(c => { c.checked = chk.checked; });
  updateSelectionCount();
}
function tableSelectAll() {
  document.querySelectorAll('#dataTableBody .row-check').forEach(c => { c.checked = true; });
  const ca = document.getElementById('checkAll');
  if (ca) ca.checked = true;
  updateSelectionCount();
}
function tableInvertSelect() {
  document.querySelectorAll('#dataTableBody .row-check').forEach(c => { c.checked = !c.checked; });
  const ca = document.getElementById('checkAll');
  if (ca) ca.checked = [...document.querySelectorAll('#dataTableBody .row-check')].every(c => c.checked);
  updateSelectionCount();
}
async function deleteSelected() {
  const ids = [...document.querySelectorAll('#dataTableBody .row-check:checked')].map(c => +c.dataset.id).filter(id => id);
  if (!ids.length) return;
  if (!confirm(`确定删除选中的 ${ids.length} 条记录？`)) return;
  _dupSelectIds.clear();

  // 批量删除
  for (const id of ids) await dbDelete(id);

  // 🔥 优化：不重新加载所有数据，只从内存中批量移除
  const deletedIds = new Set(ids);
  allRecords = allRecords.filter(r => !deletedIds.has(r.id));
  updateGlobalStats();
  renderDataTable();
}

// ── 重复战报检测 ─────────────────────────────────────────────────────
function getDuplicateGroups() {
  const groups = {};
  for (const r of allRecords) {
    if (r.leftLoss == null || r.rightLoss == null) continue;
    const key = r.leftLoss + '|' + r.rightLoss;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return Object.values(groups).filter(g => g.length >= 2);
}

function filterDuplicates() {
  _dupFilterActive = !_dupFilterActive;
  _dupSelectIds.clear();
  dataPage = 1;
  const btn = document.getElementById('btnFilterDuplicates');
  if (btn) btn.textContent = _dupFilterActive ? '✕ 取消重复筛选' : '筛选重复战报';
  renderDataTable();
  if (_dupFilterActive) {
    const groups = getDuplicateGroups();
    const dupCount = groups.reduce((sum, g) => sum + g.length, 0);
    const groupCount = groups.length;
    const tip = document.getElementById('dupFilterTip');
    if (tip) tip.textContent = `共 ${groupCount} 组重复，${dupCount} 条记录`;
  } else {
    const tip = document.getElementById('dupFilterTip');
    if (tip) tip.textContent = '';
  }
}

function selectDuplicatesForDeletion() {
  const groups = getDuplicateGroups();
  if (groups.length === 0) { alert('当前项目中未检测到重复战报'); return; }
  _dupSelectIds.clear();
  let toDeleteCount = 0;
  for (const group of groups) {
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (let i = 1; i < sorted.length; i++) {
      _dupSelectIds.add(sorted[i].id);
      toDeleteCount++;
    }
  }
  if (!_dupFilterActive) {
    _dupFilterActive = true;
    const btn = document.getElementById('btnFilterDuplicates');
    if (btn) btn.textContent = '✕ 取消重复筛选';
  }
  const tip = document.getElementById('dupFilterTip');
  if (tip) tip.textContent = `共 ${groups.length} 组重复，已预选 ${toDeleteCount} 条待删除`;
  dataPerPage = 100;
  dataPage = 1;
  renderDataTable();
  document.querySelectorAll('#dataTableBody .row-check').forEach(cb => {
    if (_dupSelectIds.has(+cb.dataset.id)) cb.checked = true;
  });
  updateSelectionCount();
}
// 事件委托：直接挂 document，捕获所有 row-check 的变更（动态内容也适用）
document.addEventListener('change', function(e) {
  if (e.target && e.target.classList.contains('row-check')) updateSelectionCount();
});

// 数据底表排序切换
function toggleDataSort(field) {
  if (dataSortField === field) {
    dataSortDir = dataSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    dataSortField = field;
    dataSortDir = 'desc';
  }
  // 更新表头显示
  updateDataTableHeaders();
  renderDataTable();
}

// 更新数据底表表头排序指示器
function updateDataTableHeaders() {
  const fields = ['leftLoss', 'leftTotal', 'leftLossRate', 'rightLoss', 'rightTotal', 'rightLossRate'];
  fields.forEach(field => {
    const el = document.getElementById('th-' + field);
    if (el) {
      const baseText = el.dataset.baseText || el.textContent.replace(/[▲▼↕]/g, '').trim();
      el.dataset.baseText = baseText;
      if (dataSortField === field) {
        el.innerHTML = baseText + (dataSortDir === 'asc' ? ' ▲' : ' ▼');
        el.style.color = 'var(--accent)';
      } else {
        el.innerHTML = baseText + ' <span class="sort-arrow">↕</span>';
        el.style.color = '';
      }
    }
  });
}

async function showRecordImage(id) {
  let imgSrc = null;

  // 1. 先查本地 IndexedDB
  try {
    const record = await dbGet(id);
    if (record && record.imageBase64) {
      imgSrc = record.imageBase64;
    }
  } catch (e) { /* ignore */ }

  // 2. 本地无图，尝试云端加载
  if (!imgSrc) {
    // 从 allRecords 获取 cloudId
    const memRec = allRecords.find(r => r.id === id);
    const cloudId = memRec ? (memRec.cloudId || memRec.cloud_id || id) : id;

    // 显示 loading 弹窗
    const loadingModal = document.createElement('div');
    loadingModal.className = 'image-modal';
    loadingModal.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;">
      <div style="text-align:center;color:var(--text2);">
        <div class="image-modal-spinner"></div>
        <div style="margin-top:12px;">加载原图中…</div>
      </div>
    </div>`;
    document.body.appendChild(loadingModal);

    try {
      // 先尝试二进制直出端点（更高效）
      const imgUrl = `${typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api'}/gallery/image/${cloudId}`;
      const testRes = await fetch(imgUrl, { method: 'HEAD' });
      if (testRes.ok) {
        imgSrc = imgUrl;
      } else {
        // 回退到 JSON 端点（base64）
        const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
        const res = await fetch(`${base}/gallery/by-battle/${cloudId}`);
        const json = await res.json();
        if (json.code === 200 && json.data && json.data.image_data) {
          imgSrc = json.data.image_data;
        }
      }
    } catch (e) {
      console.warn('[showRecordImage] 云端加载失败:', e.message);
    }

    loadingModal.remove();

    if (!imgSrc) {
      alert('该记录暂无原图（本地和云端均未找到）');
      return;
    }
  }

  // 3. 显示图片弹窗
  // 确保 imgSrc 是字符串（兼容旧 base64 字符串和 Buffer 对象）
  if (typeof imgSrc !== 'string') {
    if (imgSrc && imgSrc.type === 'Buffer' && Array.isArray(imgSrc.data)) {
      // Buffer JSON 对象 → base64 data URI
      const bytes = new Uint8Array(imgSrc.data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      imgSrc = 'data:image/png;base64,' + btoa(binary);
    } else {
      console.warn('[showRecordImage] imgSrc 不是有效字符串:', typeof imgSrc);
      alert('图片数据格式错误，无法显示');
      return;
    }
  }
  const m = document.createElement('div');
  m.className = 'image-modal';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  m.innerHTML = `
    <div style="position:relative;display:inline-block;max-width:90vw;max-height:90vh;">
      <img src="${imgSrc.replace(/"/g, '&quot;')}" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <button onclick="this.closest('.image-modal').remove()" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px;line-height:32px;text-align:center;" title="关闭">✕</button>
    </div>`;
  document.body.appendChild(m);
}

async function deleteRecord(id) {
  if (!confirm('确定删除？')) return;
  // 先获取记录，找到所属项目
  const rec = allRecords.find(r => r.id === id);
  const projId = rec ? rec.projectId : null;
  const cloudId = rec?.cloudId || rec?.cloud_id || id;

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

  // 删除战报记录（云端同步删除，会级联清理 battle_gallery）
  let cloudDeleteFailed = false;
  try {
    if (window.cloudSync && window.cloudSync.deleteRecord && cloudId) {
      const ok = await window.cloudSync.deleteRecord(cloudId);
      if (!ok) throw new Error('云端删除失败');
    }
  } catch (e) {
    console.warn('[deleteRecord] 云端删除失败:', e.message);
    cloudDeleteFailed = true;
    // 询问是否继续删除本地数据
    const continueDelete = confirm('云端删除失败，是否仅删除本地数据？\n\n提示：如果选择"确定"，将只删除本地记录，云端数据保持不变。下次同步时可能会重新出现。');
    if (!continueDelete) {
      alert('已取消删除操作');
      return;
    }
  }

  // 执行本地删除
  await dbDelete(id);

  // 记录系统日志
  if (typeof addSysLog === 'function') {
    const logMsg = '删除战报: ' + (rec ? (rec.leftPlayer || rec.rightPlayer || 'ID:' + id) : 'ID:' + id) + (projId ? ' [项目ID:' + projId + ']' : '');
    addSysLog('delete', logMsg + (cloudDeleteFailed ? ' [仅本地]' : ''));
  }

  // 🔥 优化：不重新加载所有数据，只从内存中移除
  allRecords = allRecords.filter(r => r.id !== id);
  updateGlobalStats();
  renderDataTable();

  if (cloudDeleteFailed) {
    alert('本地数据已删除\n\n注意：云端数据未删除，下次同步时可能会重新出现。');
  }
}

async function clearAllData() {
  if (!confirm('确定清空所有数据？此操作会同时清空云端数据！')) return;

  // 先清空云端记录（按 cloudId 或业务字段匹配）
  if (window.cloudSync) {
    try {
      const cloudRecords = await window.cloudSync.getRecords(window.currentProjectId || null);
      for (const cr of cloudRecords) {
        try { await window.cloudSync.deleteRecord(cr.id); } catch (e) {}
      }
      console.log('[clearAllData] 云端记录已清空，共', cloudRecords.length, '条');
    } catch (e) {
      console.warn('[clearAllData] 云端清空失败（继续清本地）:', e.message);
    }
  }

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

function exportDataCSV(scope = 'all') {
  try {
    const allData = getFilteredData();
    const data = scope === 'page'
      ? allData.slice((dataPage - 1) * dataPerPage, dataPage * dataPerPage)
      : allData;
    if (data.length === 0) { alert('当前没有可导出的数据'); return; }
    if (typeof addSysLog === 'function') {
      addSysLog('operation', '导出战报CSV(' + (scope==='page'?'本页':'全部') + '): ' + data.length + ' 条' + (window.currentProjectId ? ' [项目ID:' + window.currentProjectId + ']' : ''));
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
      getTeamKey(getGenerals(r, 'left')),
      tacStr(getGenerals(r, 'left'), getTactics(r, 'left')),
      r.leftFormation || '',
      r.leftLoss || 0,
      r.leftTotal || 0,
      r.leftLossRate != null ? Number(r.leftLossRate).toFixed(1) + '%' : '-',
      r.rightPlayer || '',
      r.rightAlliance || '',
      getTeamKey(getGenerals(r, 'right')),
      tacStr(getGenerals(r, 'right'), getTactics(r, 'right')),
      r.rightFormation || '',
      r.rightLoss || 0,
      r.rightTotal || 0,
      r.rightLossRate != null ? Number(r.rightLossRate).toFixed(1) + '%' : '-'
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
      csv += `${i + 1},"${r.time || ''}","${r.result || ''}","${r.leftPlayer || ''}","${r.leftAlliance || ''}","${getTeamKey(getGenerals(r,'left'))}","${ts(getGenerals(r,'left'), getTactics(r,'left'))}","${r.leftFormation || ''}",${r.leftLoss || 0},${r.leftTotal || 0},"${r.leftLossRate != null ? r.leftLossRate.toFixed(1) + '%' : '-'}","${r.rightPlayer || ''}","${r.rightAlliance || ''}","${getTeamKey(getGenerals(r,'right'))}","${ts(getGenerals(r,'right'), getTactics(r,'right'))}","${r.rightFormation || ''}",${r.rightLoss || 0},${r.rightTotal || 0},"${r.rightLossRate != null ? r.rightLossRate.toFixed(1) + '%' : '-'}"\n`;
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
  if (filter === 'parsed') records = records.filter(r => r.leftGeneral1);
  if (filter === 'pending') records = records.filter(r => !r.leftGeneral1 && !r.rightGeneral1);
  if (filter === 'error') records = records.filter(r => r._parseError);
  if (countEl) countEl.textContent = records.length + ' 张';
  if (empty) empty.style.display = records.length > 0 ? 'none' : 'block';
  if (container) container.style.display = records.length > 0 ? 'flex' : 'none';
  records.sort((a, b) => (b.id || 0) - (a.id || 0));
  try {
    if (container) container.innerHTML = records.map(r => {
      const isParsed = !!(r.leftGeneral1 || r.rightGeneral1);
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
  if (window.__skipInitialDataInit) {
    console.log('[DataSystem] 项目目录启动，跳过战报预加载');
    return;
  }
  if (window.__dataInitDone) {
    console.log('[DataSystem] 初始化已由登录流程完成，跳过重复加载');
    return;
  }
  await openDB();
  await loadAllRecords();
  window.__dataInitDone = true;
  renderDataTable();
  renderGallery();
  console.log('[DataSystem] 初始化完成，当前 allRecords:', allRecords.length);
}

// ============================================================
// 🗃️ 数据库表查看功能（仅超管）
// ============================================================

let dbViewerCurrentTable = null;    // 当前选中的表名
let dbViewerCurrentPage = 1;        // 当前页码
let dbViewerCurrentSort = 'id';     // 当前排序字段
let dbViewerCurrentOrder = 'ASC';   // 当前排序方向
let dbViewerDescVisible = false;     // 表结构面板是否展开

/** 初始化数据库查看器（超管才显示） */
function initDBViewer() {
  const section = document.getElementById('dbViewerSection');
  if (!section) return;
  // 仅超管可见
  if (currentUser && currentUser.roleId === 'super_admin') {
    section.style.display = 'block';
    refreshDBViewer();
  }
}

/** 刷新：重新加载表列表 */
async function refreshDBViewer() {
  const grid = document.getElementById('dbTableGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);grid-column:1/-1;">⏳ 正在加载表列表...</div>';

  if (!window.cloudSync || !window.cloudSync.getDBTables) {
    grid.innerHTML = '<div style="text-align:center;padding:16px;color:#ff5252;grid-column:1/-1;">❌ 云端同步不可用</div>';
    return;
  }

  try {
    const tables = await window.cloudSync.getDBTables();
    if (!tables || !tables.length) {
      grid.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);grid-column:1/-1;">暂无数据</div>';
      return;
    }

    // 表名中文映射
    const tableNames = {
      users:'用户表', roles:'角色表', projects:'项目表',
      project_members:'项目成员', battle_records:'战报记录',
      battle_gallery:'战报图库', ocr_pending_tasks:'OCR任务',
      system_logs:'系统日志', team_plans:'配将方案',
      yanwu_records:'演武记录', user_credits:'用户积分',
      credit_logs:'积分日志'
    };

    grid.innerHTML = tables.map(t => `
      <div class="db-table-card${dbViewerCurrentTable===t.name?' active':''}"
           onclick="selectDBTable('${t.name}')"
           style="cursor:pointer;padding:12px;border-radius:6px;text-align:center;border:2px solid ${dbViewerCurrentTable===t.name?'var(--accent)':'var(--border)'};background:${dbViewerCurrentTable===t.name?'rgba(var(--accent-rgb),0.08)':'var(--bg2)'};transition:all 0.15s;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px;">📋 ${tableNames[t.name]||t.name}</div>
        <div style="font-size:18px;font-weight:700;color:${t.count>0?'var(--accent)':'var(--text3)'};">${t.count}</div>
        <div style="font-size:10px;color:var(--text3);">条记录</div>
      </div>
    `).join('');

    // 如果之前选中过某张表，自动加载
    if (dbViewerCurrentTable) {
      loadDBTableData();
    } else if (tables.length > 0) {
      // 默认选第一张有数据的表
      const firstWithData = tables.find(t => t.count > 0);
      if (firstWithData) selectDBTable(firstWithData.name);
    }
  } catch(e) {
    console.error('[refreshDBViewer]', e);
    grid.innerHTML = '<div style="text-align:center;padding:16px;color:#ff5252;grid-column:1/-1;">❌ 加载失败: '+e.message+'</div>';
  }
}

/** 选择一张表 */
function selectDBTable(tableName) {
  dbViewerCurrentTable = tableName;
  dbViewerCurrentPage = 1;
  dbViewerCurrentSort = 'id';
  dbViewerCurrentOrder = 'DESC';
  document.getElementById('dbDescToggleBtn').style.display = '';
  // 更新卡片激活状态
  refreshDBViewer();
}

/** 加载当前表的数据 */
async function loadDBTableData() {
  if (!dbViewerCurrentTable) return;

  const wrap = document.getElementById('dbDataTable');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);">⏳ 查询中...</div>';

  // 更新信息栏
  document.getElementById('dbTableNameLabel').textContent = '📋 表: ' + dbViewerCurrentTable;
  document.getElementById('dbPaginationInfo').textContent = '';

  const pageSize = parseInt(document.getElementById('dbPageSizeSelect')?.value || '20');
  const search = document.getElementById('dbSearchInput')?.value?.trim() || '';

  try {
    const data = await window.cloudSync.queryTable(dbViewerCurrentTable, {
      page: dbViewerCurrentPage,
      pageSize,
      sort: dbViewerCurrentSort,
      order: dbViewerCurrentOrder,
      search
    });

    if (!data || !data.columns) {
      wrap.innerHTML = '<div style="text-align:center;padding:30px;color:#ff5252;">❌ 无返回数据</div>';
      return;
    }

    renderDBDataTable(data);

    // 分页信息
    const { pagination } = data;
    document.getElementById('dbPaginationInfo').textContent =
      `共 ${pagination.total} 条 · 第 ${pagination.page}/${pagination.totalPages} 页`;

    renderDBPagination(pagination);
  } catch(e) {
    console.error('[loadDBTableData]', e);
    wrap.innerHTML = '<div style="text-align:center;padding:30px;color:#ff5252;">❌ 查询失败: '+e.message+'</div>';
  }
}

/** 渲染数据表格 */
function renderDBDataTable(data) {
  const { columns, rows } = data;
  const wrap = document.getElementById('dbDataTable');

  if (!rows || rows.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);">📭 该表暂无数据</div>';
    return;
  }

  // 判断列类型辅助函数
  function isJsonCol(name) {
    const knownJsonCols = { battle_records: [], roles: ['permissions'] };
    const jsonCols = knownJsonCols[dbViewerCurrentTable] || [];
    return jsonCols.includes(name) || columns.find(c=>c.field===name && c.type.startsWith('json'));
  }

  function isDateCol(name) {
    return name.includes('_at') || name.includes('_time') || name.includes('_date');
  }

  // 构建表头（可点击排序）
  let headerHtml = '<tr>' +
    columns.map(col => {
      const isActive = dbViewerCurrentSort === col.field;
      const arrow = isActive ? (dbViewerCurrentOrder === 'DESC' ? ' ▼' : ' ▲') : '';
      return `<th style="padding:7px 10px;text-align:left;font-size:11px;white-space:nowrap;background:var(--bg2);color:${isActive?'var(--accent)':'var(--text2)'};cursor:pointer;border-bottom:2px solid var(--border);user-select:none;" onclick="sortDBTable('${col.field}')" title="点击${isActive?'切换排序':'按此列排序'}">${col.field}${arrow}</th>`;
    }).join('') + '</tr>';

  // 构建数据行
  let bodyHtml = rows.map(row => {
    return '<tr style="border-bottom:1px solid var(--border);">' +
      columns.map(col => {
        let val = row[col.field];
        if (val === null || val === undefined) {
          return `<td style="padding:6px 10px;font-size:11px;color:var(--text3);max-width:250px;"><span style="color:var(--text3);font-style:italic;">NULL</span></td>`;
        }
        // 密码脱敏
        if (col.field === 'password' && val === '****') {
          return `<td style="padding:6px 10px;font-size:11px;color:var(--red);max-width:250px;"><span style="background:rgba(255,0,0,0.06);padding:1px 5px;border-radius:3px;">****</span></td>`;
        }
        // JSON 字段
        if (typeof val === 'object') val = JSON.stringify(val);
        if (isJsonCol(col.field)) {
          let display = typeof val === 'string' ? val : String(val);
          const isLong = display.length > 120;
          if (isLong) display = display.substring(0, 120) + '...';
          // 简单JSON格式化显示
          try {
            const parsed = JSON.parse(display.replace(/\.\.\.$/,''));
            if (typeof parsed !== 'object') throw new Error('');
            display = JSON.stringify(parsed, null, 0).replace(/,/g,', ');
            if (display.length > 120) display = display.substring(0, 120)+'...';
          } catch(e){}
          return `<td style="padding:6px 10px;font-size:11px;max-width:300px;word-break:break-all;"><span style="color:var(--cyan);font-family:monospace;font-size:10px;background:rgba(0,200,200,0.04);padding:2px 4px;border-radius:3px;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(typeof val==='string'?val:val).replace(/"/g,'&quot;')}">${escHtml(display)}</span></td>`;
        }
        // 日期字段格式化
        if (isDateCol(col.field) && typeof val === 'string' && /^\d{4}-\d{2}/.test(val)) {
          try {
            val = new Date(val).toLocaleString('zh-CN');
          } catch(e) {}
        }
        // 长文本截断
        const strVal = String(val);
        const displayText = strVal.length > 80 ? strVal.substring(0, 80) + '...' : strVal;
        return `<td style="padding:6px 10px;font-size:11px;max-width:250px;word-break:break-all;" title="${strVal.replace(/"/g,'&quot;')}">${escHtml(displayText)}</td>`;
      }).join('') + '</tr>';
  }).join('');

  wrap.innerHTML =
    `<table style="width:100%;border-collapse:collapse;">
      <thead>${headerHtml}</thead>
      <tbody style="background:var(--bg);">${bodyHtml}</tbody>
    </table>`;
}

/** 排序切换 */
function sortDBTable(field) {
  if (dbViewerCurrentSort === field) {
    dbViewerCurrentOrder = dbViewerCurrentOrder === 'DESC' ? 'ASC' : 'DESC';
  } else {
    dbViewerCurrentSort = field;
    dbViewerCurrentOrder = 'ASC';
  }
  loadDBTableData();
}

/** 渲染分页控件 */
function renderDBPagination(pag) {
  const container = document.getElementById('dbPagination');
  if (!container || pag.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const maxButtons = 7;
  let buttons = [];

  if (pag.page > 1) buttons.push(`<button class="btn btn-sm" onclick="goDBPage(${pag.page-1})">‹</button>`);

  let startPage = Math.max(1, pag.page - Math.floor(maxButtons / 2));
  let endPage = Math.min(pag.totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

  for (let i = startPage; i <= endPage; i++) {
    const active = i === pag.page;
    buttons.push(active ?
      `<button class="btn btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent);" disabled>${i}</button>` :
      `<button class="btn btn-sm" onclick="goDBPage(${i})">${i}</button>`);
  }

  if (pag.page < pag.totalPages) buttons.push(`<button class="btn btn-sm" onclick="goDBPage(${pag.page+1})">›</button>`);

  container.innerHTML = buttons.join(' ');
}

/** 跳转页面 */
function goDBPage(page) {
  dbViewerCurrentPage = page;
  loadDBTableData();
}

/** 展开/收起表结构 */
async function toggleDBDesc() {
  const panel = document.getElementById('dbDescPanel');
  const content = document.getElementById('dbDescContent');

  if (dbViewerDescVisible) {
    panel.style.display = 'none';
    document.getElementById('dbDescToggleBtn').style.display = '';
    dbViewerDescVisible = false;
    return;
  }

  if (!dbViewerCurrentTable) return;

  content.innerHTML = '⏳ 加载中...';
  panel.style.display = 'block';
  document.getElementById('dbDescToggleBtn').style.display = 'none';
  dbViewerDescVisible = true;

  try {
    const desc = await window.cloudSync.describeTable(dbViewerCurrentTable);
    if (!desc) throw new Error('无返回数据');

    content.innerHTML = `
      <div style="margin-bottom:8px;">
        <strong>注释:</strong> ${desc.comment || '-'}
        <span style="color:var(--text3);margin-left:12px;">行数≈${desc.rows}</span>
        <span style="color:var(--text3);margin-left:12px;">数据大小≈${(desc.dataSize/1024).toFixed(1)}KB</span>
        <span style="color:var(--text3);margin-left:12px;">索引大小≈${(desc.indexSize/1024).toFixed(1)}KB</span>
        ${desc.autoIncrement ? `<span style="color:var(--text3);margin-left:12px;">AUTO_INCREMENT=${desc.autoIncrement}</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">
        <thead><tr style="background:var(--bg2);">
          <th style="padding:4px 8px;text-align:left;">字段</th><th style="padding:4px 8px;text-align:left;">类型</th>
          <th style="padding:4px 8px;text-align:center;">可空</th><th style="padding:4px 8px;text-align:left;">键</th>
          <th style="padding:4px 8px;text-align:left;">默认值</th><th style="padding:4px 8px;text-align:left;">Extra</th>
        </tr></thead>
        <tbody>${desc.columns.map(c => `<tr style="border-top:1px solid var(--border);">
          <td style="padding:4px 8px;color:var(--accent);font-family:monospace;">${c.field}</td>
          <td style="padding:4px 8px;color:var(--cyan);font-family:monospace;font-size:10px;">${c.type}</td>
          <td style="padding:4px 8px;text-align:center;color:${c.nullable?'var(--text3)':'var(--green)'};">${c.nullable?'YES':'NO'}</td>
          <td style="padding:4px 8px;">${c.key||'-'}</td>
          <td style="padding:4px 8px;color:var(--text3);">${c.default??'-'}</td>
          <td style="padding:4px 8px;color:var(--text3);font-size:10px;">${c.extra||''}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div style="font-size:11px;color:var(--text3);">
        <strong>索引:</strong> ${desc.indexes.length === 0 ? '无' :
          desc.indexes.map(i => `<span style="background:var(--bg2);padding:1px 6px;border-radius:3px;margin-right:6px;">${i.name}${i.unique?'(唯一)':''}: [${i.columns.join(',')}]</span>`).join('')}
      </div>`;
  } catch(e) {
    content.innerHTML = '<span style="color:#ff5252;">❌ ' + e.message + '</span>';
  }
}

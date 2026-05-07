/**
 * 云端同步模块 - 封装所有云端 API 调用
 * 使用方式：在 index.html 中引入此文件，然后在其他 JS 中调用相关函数
 * 版本: v202605080159
 */

// 环境切换：false=使用 FRP 内网穿透
const CLOUD_LOCAL_DEV = false;

const CLOUD_API_BASE = 'https://api.zhenwu.fun/api';

// ========== 辅助函数：获取当前用户 ==========
function getCurrentUserPhone() {
  return currentUser ? currentUser.phone : null;
}

function getCurrentUserRole() {
  return currentUser ? currentUser.role : null;
}

// ========== 辅助函数：获取 JWT Token ==========
function getToken() {
  return localStorage.getItem('nslg_token') || '';
}

function setToken(token) {
  if (token) {
    localStorage.setItem('nslg_token', token);
  } else {
    localStorage.removeItem('nslg_token');
  }
}

// ========== 辅助函数：通用 API 请求 ==========
async function cloudRequest(path, options = {}) {
  const url = `${CLOUD_API_BASE}${path}`;
  const token = getToken();
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {})
    },
    // 不使用 cookie 认证，后端使用 JWT
  };
  const finalOptions = { ...defaultOptions, ...options };
  if (finalOptions.body && typeof finalOptions.body !== 'string') {
    finalOptions.body = JSON.stringify(finalOptions.body);
  }

  try {
    // 动态超时：OCR 90秒，数据同步/批量操作 60秒，普通请求 30秒
    const isOCR = url.includes('/ocr');
    const isBatch = url.includes('/records') || url.includes('/battles');
    const timeoutMs = isOCR ? 90000 : (isBatch ? 60000 : 30000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { ...finalOptions, signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await resp.json();
    if (!resp.ok) {
      // 401: Token 无效或过期，清除本地 token
      if (resp.status === 401) {
        console.warn('[Cloud Sync] Token 无效或过期，已清除本地 token');
        setToken(null);  // 清除无效 token
      }
      throw new Error(data.message || data.error || `请求失败(${resp.status})`);
    }
    // 标准化：后端返回 { success:true, data } 或 { code:200, data }，统一字段
    if (data.code === 200 && !data.success) {
      data.success = true;
    } else if (data.success === true && !data.code) {
      data.code = 200;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      const isOCR = path.includes('/ocr');
      const isBatch = path.includes('/records') || path.includes('/battles');
      const timeoutLabel = isOCR ? '90秒' : (isBatch ? '60秒' : '30秒');
      console.error('[Cloud Sync] 请求超时:', path, `(${timeoutLabel})`);
    } else {
      console.error('[Cloud Sync] 请求失败:', path, e.message || e);
    }
    throw e;
  }
}

// ========== 通用 API 请求函数 ==========
async function cloudRequestAPI(path, options = {}) {
  return await cloudRequest(path, options);
}

// ========== 项目管理 API ==========

// 获取项目列表（从云端）
async function cloudGetProjects() {
  const phone = getCurrentUserPhone();
  const role = getCurrentUserRole();
  if (!phone) throw new Error('未登录');

  const data = await cloudRequest(`/projects?phone=${encodeURIComponent(phone)}&role=${encodeURIComponent(role || '')}`);
  // 兼容两种响应格式：{ success, data } 或 { code, data } (data 是数组)
  const list = data.code === 200 ? data.data : (data.success ? data.data : null);
  return Array.isArray(list) ? list : [];
}

// 获取单个项目详情（从云端）
async function cloudGetProject(projectId) {
  const data = await cloudRequest(`/projects/${projectId}`);
  const project = data.code === 200 ? data.data : (data.success ? data.data : null);
  return project || null;
}

// ========== 用户管理 API ==========
async function cloudGetUsers() {
  try {
    const data = await cloudRequest('/users');
    const list = (data.data && data.data.list) || [];
    return list.map(u => ({
      phone: u.phone,
      name: u.nickname || u.name || '',
      role: u.role_id || u.role || 'member',
      points: u.points || 0,
      createdAt: u.created_at ? new Date(u.created_at).getTime() : Date.now(),
      password: ''
    }));
  } catch (e) {
    console.error('[cloudGetUsers] 失败:', e);
    return [];
  }
}

// 更新用户积分（云端）
async function cloudUpdateUserPoints(phone, points) {
  try {
    // 需要通过手机号找到用户的云端ID
    const data = await cloudRequest('/users');
    const list = (data.data && data.data.list) || [];
    const user = list.find(u => u.phone === phone);
    if (!user || !user.id) {
      console.warn('[cloudUpdateUserPoints] 未找到用户:', phone);
      return false;
    }
    const res = await cloudRequest(`/users/${user.id}`, {
      method: 'PUT',
      body: { points: points }
    });
    return res.code === 200;
  } catch (e) {
    console.error('[cloudUpdateUserPoints] 失败:', e);
    return false;
  }
}

// 创建项目（云端）
async function cloudCreateProject(project) {
  const data = await cloudRequest('/projects', {
    method: 'POST',
    body: project
  });
  return data.success ? data.data : null;
}

// 更新项目（云端）
async function cloudUpdateProject(projectId, updates) {
  const data = await cloudRequest(`/projects/${projectId}`, {
    method: 'PUT',
    body: updates
  });
  return data.success;
}

// 删除项目（云端）
async function cloudDeleteProject(projectId) {
  const data = await cloudRequest(`/projects/${projectId}`, {
    method: 'DELETE'
  });
  return data.success;
}

// 获取项目成员（云端）
async function cloudGetProjectMembers(projectId) {
  const data = await cloudRequest(`/projects/${projectId}/members`);
  return data.success ? data.data : [];
}

// 添加项目成员（云端）
async function cloudAddProjectMember(projectId, phone, canEdit = true, canDelete = false, grantedBy = '') {
  const data = await cloudRequest(`/projects/${projectId}/members`, {
    method: 'POST',
    body: { phone, can_edit: canEdit, can_delete: canDelete, granted_by: grantedBy }
  });
  return data.success;
}

// 删除项目成员（云端）
async function cloudRemoveProjectMember(projectId, phone) {
  const data = await cloudRequest(`/projects/${projectId}/members/${phone}`, {
    method: 'DELETE'
  });
  return data.success;
}

// ========== 战报管理 API ==========

// 获取战报列表（从云端）
// 后端路由是 /battles，不是 /records
async function cloudGetRecords(projectId = null) {
  const url = projectId ? `/battles?projectId=${encodeURIComponent(projectId)}` : '/battles';
  const data = await cloudRequest(url);
  // 兼容两种响应格式：{ code, data:{list} } 或 { code, data:[...] }
  const list = data.code === 200 ? (Array.isArray(data.data) ? data.data : (data.data?.list || [])) : [];
  // 字段映射：云端驼峰 → 前端 IndexedDB 字段名
  return list.map(r => ({
    id: r.id,
    projectId: (r.projectId !== undefined && r.projectId !== null) ? r.projectId : (r.project_id || null),
    time: r.battleDate || r.battle_date || r.battleTime || '',
    result: r.result || '',
    leftPlayer: r.attackerName || r.attacker_name || '',
    rightPlayer: r.enemyName || r.enemy_name || '',
    leftAlliance: r.leftAlliance || r.left_alliance || '',
    rightAlliance: r.rightAlliance || r.right_alliance || '',
    leftGenerals: r.leftGenerals || [],
    rightGenerals: r.rightGenerals || [],
    leftTactics: r.leftTactics || [],
    rightTactics: r.rightTactics || [],
    leftFormation: r.leftFormation || r.left_formation || '',
    rightFormation: r.rightFormation || r.right_formation || '',
    leftLoss: r.leftLoss ?? r.left_loss ?? null,
    leftTotal: r.leftTotal ?? r.left_total ?? null,
    rightLoss: r.rightLoss ?? r.right_loss ?? null,
    rightTotal: r.rightTotal ?? r.right_total ?? null,
    leftLossRate: r.leftLossRate ?? r.left_loss_rate ?? null,
    rightLossRate: r.rightLossRate ?? r.right_loss_rate ?? null,
    description: r.description || '',
    imageBase64: r.imageBase64 || r.image_base64 || '',
    _synced: true,
    _syncTime: Date.now()
  }));
}

// 创建战报（云端）- 排除大字段（图片等）
// 接收字段：projectId, battleDate, attackerName, enemyName, result, description
async function cloudCreateRecord(record) {
  // 创建记录的副本，排除大字段
  const recordForCloud = { ...record };
  // 移除 base64 图片（太大，D1 限制 1MB）
  delete recordForCloud.imageBase64;
  delete recordForCloud.imageData;
  delete recordForCloud.ocrImage;
  if (recordForCloud.data && typeof recordForCloud.data === 'object') {
    const dataCopy = { ...recordForCloud.data };
    delete dataCopy.ocrImage;
    delete dataCopy.imageBase64;
    delete dataCopy.imageData;
    recordForCloud.data = dataCopy;
  }

  const data = await cloudRequest('/battles', {
    method: 'POST',
    body: recordForCloud
  });
  return data.code === 200 ? data.data : null;
}

// 更新战报（云端）
// 注意：后端路由是 /battles，不是 /records
async function cloudUpdateRecord(recordId, recordData) {
  const result = await cloudRequest(`/battles/${recordId}`, {
    method: 'PUT',
    body: recordData
  });
  return result.success || result.code === 200;
}

// 删除战报（云端）
async function cloudDeleteRecord(recordId) {
  const data = await cloudRequest(`/battles/${recordId}`, {
    method: 'DELETE'
  });
  return data.success || data.code === 200;
}

// ========== 用户管理 API ==========

// 用户登录（云端验证）
async function cloudLogin(phone, password) {
  // 登录接口不需要 token，不能用 cloudRequest（会自动加 Authorization 头）
  const res = await fetch(`${CLOUD_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password })
  });
  const data = await res.json();
  // 后端返回格式: { code: 200, data: { token, user } }
  if (data && data.code === 200 && data.data && data.data.token) {
    setToken(data.data.token);
    return data.data.user;
  }
  return null;
}

// 创建用户（注册）
async function cloudCreateUser(phone, name, password, role = 'member') {
  // 注意：此接口不需要 token，所以不能用 cloudRequest（会自动加 Authorization 头）
  const res = await fetch(`${CLOUD_API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, nickname: name, password, role })
  });
  const data = await res.json();
  return data.code === 200;
}

// ========== 战报管理（云端）==========
// 注意：所有创建/更新调用统一走 cloudCreateRecord / cloudUpdateRecord
// 字段规范：projectId, battleDate, attackerName, enemyName, result, description

// 获取战报列表（云端）
// 后端返回格式：{ code:200, data:{ list:[], total, page, pageSize } }
async function cloudGetBattles(projectId) {
  const params = projectId ? `?projectId=${projectId}` : '';
  const data = await cloudRequest(`/battles${params}`);
  // 兼容两种返回格式：data.data.list 或 data.data
  if (data && data.code === 200 && data.data) {
    return Array.isArray(data.data) ? data.data : (data.data.list || []);
  }
  return [];
}

// 更新战报（云端）
async function cloudUpdateBattle(battleId, updates) {
  const data = await cloudRequest(`/battles/${battleId}`, {
    method: 'PUT',
    body: updates
  });
  return data.code === 200;
}

// 删除战报（云端）
async function cloudDeleteBattle(battleId) {
  const data = await cloudRequest(`/battles/${battleId}`, {
    method: 'DELETE'
  });
  return data.code === 200;
}

// ========== 同步策略 ==========

/**
 * 同步策略：
 * 1. 登录时：从云端拉取数据 → 保存到本地 IndexedDB（作为缓存）
 * 2. 创建/更新/删除：先操作云端 → 成功后更新本地缓存
 * 3. 查询数据：优先使用本地缓存（快速显示）→ 后台同步云端数据
 * 4. 离线时：仅使用本地缓存，网络恢复后同步
 */

// 登录时同步云端数据到本地
async function syncCloudToLocal() {
  if (!currentUser) return;

  // 修复：无 token 时跳过云端同步，避免 401 错误
  const token = getToken();
  if (!token) {
    console.log('[Sync] 无有效 token，跳过云端同步，仅使用本地数据');
    return false;
  }

  try {
    // 1. 同步项目列表
    const cloudProjects = await cloudGetProjects();
    for (const proj of cloudProjects) {
      await projDBPut(proj);
    }
    console.log('[Sync] 项目同步完成，共', cloudProjects.length, '个');

    // 2. 同步数据权限（projAccess）
    try {
      // 从云端获取当前用户的所有项目权限
      // 注意：后端 /users/:id/permissions 返回的是角色权限对象，不是项目权限数组
      // 项目权限通过 /projects/:id/members 获取，此处暂时跳过
      console.log('[Sync] 数据权限同步：跳过（项目权限通过项目成员接口获取）');
    } catch (e) {
      console.warn('[Sync] 数据权限同步失败（不影响其他数据）:', e);
    }

    // 3. 同步战报列表（增量同步：只同步有差异的战报）
    try {
      const cloudRecords = await cloudGetRecords();
      let syncCount = 0;
      for (const rec of cloudRecords) {
        try {
          await dbPut(rec);
          syncCount++;
        } catch (e) {
          console.warn('[Sync] 战报同步失败（跳过）:', rec.id, e);
        }
      }
      console.log('[Sync] 战报同步完成，共', syncCount, '/', cloudRecords.length, '条');
    } catch (e) {
      console.warn('[Sync] 战报同步失败（不影响项目列表）:', e);
    }

    return true;
  } catch (e) {
    console.error('[Sync] 同步失败:', e);
    return false;
  }
}

// ========== 数据权限 API（projAccess 本地读取）==========
// getMyAccess：返回当前用户在 projAccess 表中的所有授权记录
// 用于 filterVisibleProjects 的 P4 公共项目 + P2 成员可见性校验
// 注意：PROJ_ACCESS_STORE 已由 data-perm.js 在全局声明

function _openUserDBForAccess() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('nslg_userdb', 1);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function cloudGetMyAccess() {
  const phone = getCurrentUserPhone();
  if (!phone) return [];
  try {
    const db = await _openUserDBForAccess();
    if (!db.objectStoreNames.contains(PROJ_ACCESS_DB)) return [];
    return new Promise((resolve, reject) => {
      const tx  = db.transaction([PROJ_ACCESS_DB], 'readonly');
      const all = tx.objectStore(PROJ_ACCESS_DB).getAll();
      all.onsuccess = () => resolve((all.result || []).filter(a => a.phone === phone));
      all.onerror   = () => resolve([]);
    });
  } catch(e) {
    return [];
  }
}

// 角色同步：从云端拉取所有角色（数据库为真相之源）
async function cloudGetRoles() {
  try {
    const data = await cloudRequest('/roles');
    // 后端返回 { success: true, data: [...] }
    if (data && (data.success === true || data.code === 200)) {
      return data.data || [];
    }
    return [];
  } catch(e) {
    console.error('[cloudGetRoles] 失败:', e);
    return [];
  }
}

// 角色同步：推送单个角色到云端
async function cloudSaveRole(role) {
  try {
    await cloudRequest('/roles', {
      method: 'POST',
      body: JSON.stringify(role),
    });
  } catch(e) {
    console.error('[cloudSaveRole] 失败:', e);
  }
}

// 导出给全局使用
window.cloudSync = {
  getProjects: cloudGetProjects,
  createProject: cloudCreateProject,
  updateProject: cloudUpdateProject,
  deleteProject: cloudDeleteProject,
  getProjectMembers: cloudGetProjectMembers,
  addProjectMember: cloudAddProjectMember,
  removeProjectMember: cloudRemoveProjectMember,
  getRecords: cloudGetRecords,
  createRecord: cloudCreateRecord,
  updateRecord: cloudUpdateRecord,
  deleteRecord: cloudDeleteRecord,
  getProject: cloudGetProject,
  login: cloudLogin,
  createUser: cloudCreateUser,
  syncToLocal: syncCloudToLocal,
  // 通用 API 请求函数
  request: cloudRequestAPI,
  // Token 管理
  setToken: setToken,
  getToken: getToken,
  // 数据权限
  getMyAccess: cloudGetMyAccess,
  // 角色同步
  getRoles: cloudGetRoles,
  // 用户同步
  getUsers: cloudGetUsers,
  saveRole: cloudSaveRole,
  // 存储统计
  getStorageStats: cloudGetStorageStats,
  // 积分同步
  updateUserPoints: cloudUpdateUserPoints,
};

// ========== 存储统计 API ==========

// 获取存储统计
async function cloudGetStorageStats() {
  try {
    const data = await cloudRequest('/stats/storage');
    if (data && data.code === 200 && data.data) {
      return data.data;
    }
    return null;
  } catch (e) {
    console.error('[cloudGetStorageStats] 失败:', e);
    return null;
  }
}

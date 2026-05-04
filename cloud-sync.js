/**
 * 云端同步模块 - 封装所有云端 API 调用
 * 使用方式：在 index.html 中引入此文件，然后在其他 JS 中调用相关函数
 * 版本: v2026050505
 */

// 环境切换：true=本地测试(localhost:8787)，false=线上生产(api.zhenwu.fun)
const CLOUD_LOCAL_DEV = false;

const CLOUD_API_BASE = CLOUD_LOCAL_DEV ? 'http://127.0.0.1:8787/api' : 'https://api.zhenwu.fun/api';

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
    const resp = await fetch(url, finalOptions);
    const data = await resp.json();
    if (!resp.ok) {
      // 401: Token 无效或过期，清除本地 token
      if (resp.status === 401) {
        console.warn('[Cloud Sync] Token 无效或过期，已清除本地 token');
        setToken(null);  // 清除无效 token
      }
      throw new Error(data.message || data.error || `请求失败(${resp.status})`);
    }
    // 标准化：后端返回 { code:200, data }，前端期望 { success:true, data }
    if (data.code === 200 && !data.success) {
      data.success = true;
    }
    return data;
  } catch (e) {
    console.error('[Cloud Sync] 请求失败:', path, e.message || e);
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
  return data.success ? data.data : [];
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
async function cloudGetRecords(projectId = null) {
  const url = projectId ? `/records?project_id=${encodeURIComponent(projectId)}` : '/records';
  const data = await cloudRequest(url);
  return data.success ? data.data : [];
}

// 创建战报（云端）- 排除大字段（图片等）
async function cloudCreateRecord(record) {
  // 创建记录的副本，排除大字段
  const recordForCloud = { ...record };
  // 移除 base64 图片（太大，D1 限制 1MB）
  if (recordForCloud.data && typeof recordForCloud.data === 'object') {
    const dataCopy = { ...recordForCloud.data };
    delete dataCopy.ocrImage;  // 移除 base64 图片
    delete dataCopy.imageData;  // 移除其他可能的图片字段
    recordForCloud.data = dataCopy;
  }
  
  const data = await cloudRequest('/records', {
    method: 'POST',
    body: recordForCloud
  });
  return data.success ? data.data : null;
}

// 更新战报（云端）- 排除大字段（图片等）
async function cloudUpdateRecord(recordId, recordData) {
  // 创建数据的副本，排除大字段
  const dataForCloud = { ...recordData };
  // 移除 base64 图片（太大，D1 限制 1MB）
  if (dataForCloud && typeof dataForCloud === 'object') {
    delete dataForCloud.ocrImage;  // 移除 base64 图片
    delete dataForCloud.imageData;  // 移除其他可能的图片字段
  }
  
  const result = await cloudRequest(`/records/${recordId}`, {
    method: 'PUT',
    body: { data: dataForCloud }
  });
  return result.success;
}

// 删除战报（云端）
async function cloudDeleteRecord(recordId) {
  const data = await cloudRequest(`/records/${recordId}`, {
    method: 'DELETE'
  });
  return data.success;
}

// ========== 用户管理 API ==========

// 用户登录（云端验证）
async function cloudLogin(phone, password) {
  const data = await cloudRequest('/auth/login', {
    method: 'POST',
    body: { phone, password }
  });
  // 后端返回格式: { code: 200, data: { token, user } }
  if (data && data.code === 200 && data.data && data.data.token) {
    setToken(data.data.token);
    return data.data.user;
  }
  return null;
}

// 创建用户（注册）
async function cloudCreateUser(phone, name, password, role = 'member') {
  // 修复：改用 /auth/register 公开接口（不需要权限）
  // 注意：此接口不需要 token，所以不能用 cloudRequest（会自动加 Authorization 头）
  const base = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://api.zhenwu.fun';
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, nickname: name, password, role })
  });
  const data = await res.json();
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
      const cloudPermissions = await cloudRequest(`/users/${currentUser.phone}/permissions`);
      if (cloudPermissions && cloudPermissions.success && cloudPermissions.data) {
        const permData = cloudPermissions.data;
        // 保存到本地 projAccess store
        for (const perm of permData) {
          await permDBPut({
            id: perm.phone + '_' + perm.project_id,
            phone: perm.phone,
            projectId: perm.project_id,
            grantedBy: perm.granted_by || '',
            grantedAt: perm.granted_at || new Date().toISOString(),
            canEdit: perm.can_edit === 1 || perm.can_edit === true,
            canDelete: perm.can_delete === 1 || perm.can_delete === true
          });
        }
        console.log('[Sync] 数据权限同步完成，共', permData.length, '条');
      }
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
  login: cloudLogin,
  createUser: cloudCreateUser,
  syncToLocal: syncCloudToLocal,
  // 通用 API 请求函数
  request: cloudRequestAPI,
  // Token 管理
  setToken: setToken,
  getToken: getToken
};

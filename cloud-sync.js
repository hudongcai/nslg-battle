/**
 * 云端同步模块 - 封装所有云端 API 调用
 * 使用方式：在 index.html 中引入此文件，然后在其他 JS 中调用相关函数
 * 版本: v2026050413
 */

// 环境切换：true=本地测试(localhost:8787)，false=线上生产(zhenwu.fun)
const CLOUD_LOCAL_DEV = false;

const CLOUD_API_BASE = CLOUD_LOCAL_DEV ? 'http://127.0.0.1:8787/api' : '/api';

// ========== 辅助函数：获取当前用户 ==========
function getCurrentUserPhone() {
  return currentUser ? currentUser.phone : null;
}

function getCurrentUserRole() {
  return currentUser ? currentUser.role : null;
}

// ========== 辅助函数：通用 API 请求 ==========
async function cloudRequest(path, options = {}) {
  const url = `${CLOUD_API_BASE}${path}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json'
    }
  };
  const finalOptions = { ...defaultOptions, ...options };
  if (finalOptions.body && typeof finalOptions.body !== 'string') {
    finalOptions.body = JSON.stringify(finalOptions.body);
  }

  try {
    const resp = await fetch(url, finalOptions);
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || '请求失败');
    }
    return data;
  } catch (e) {
    console.error('[Cloud Sync] 请求失败:', path, e);
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

// 创建战报（云端）
async function cloudCreateRecord(record) {
  const data = await cloudRequest('/records', {
    method: 'POST',
    body: record
  });
  return data.success ? data.data : null;
}

// 更新战报（云端）
async function cloudUpdateRecord(recordId, data) {
  const result = await cloudRequest(`/records/${recordId}`, {
    method: 'PUT',
    body: { data }
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
  const data = await cloudRequest('/users/login', {
    method: 'POST',
    body: { phone, password }
  });
  return data.success ? data.data : null;
}

// 创建用户（注册）
async function cloudCreateUser(phone, name, password, role = 'member') {
  const data = await cloudRequest('/users', {
    method: 'POST',
    body: { phone, name, password, role }
  });
  return data.success;
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

  try {
    // 1. 同步项目列表
    const cloudProjects = await cloudGetProjects();
    for (const proj of cloudProjects) {
      await projDBPut(proj);
    }
    console.log('[Sync] 项目同步完成，共', cloudProjects.length, '个');

    // 2. 同步战报列表（可选，数据量可能很大）
    // const cloudRecords = await cloudGetRecords();
    // for (const rec of cloudRecords) {
    //   await dbPut(rec);
    // }
    // console.log('[Sync] 战报同步完成，共', cloudRecords.length, '条');

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
  request: cloudRequestAPI
};

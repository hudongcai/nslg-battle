/**
 * 云端同步模块 - 封装所有云端 API 调用
 * 使用方式：在 index.html 中引入此文件，然后在其他 JS 中调用相关函数
 * 版本: v202605112300
 */

// 根据当前页面域名自动确定 API 地址 - 直接调用 MySQL API，绕过 Cloudflare Worker
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const CLOUD_API_BASE = isLocal ? 'http://localhost:3000/api' : 'https://api.zhenwu.fun/api';

// JSON 安全解析（后端返回的 JSON 字段可能是字符串）
function safeJSONParse(val) {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch (e) { return null; }
  }
  return val;
}

// ========== 辅助函数：获取当前用户 ==========
function getCurrentUserPhone() {
  return currentUser ? currentUser.phone : null;
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
        // 401: 需要区分"账号已删/禁"和"token 过期"
        if (resp.status === 401) {
          const errMsg = data.message || '';
          // 账号被删除或禁用：不重试，直接强制退出
          const isFatal = errMsg.includes('账号不存在') || errMsg.includes('已被禁用') || errMsg.includes('已被删除');
          if (isFatal) {
            console.warn('[Cloud Sync] 账号已删除或禁用，强制退出:', errMsg);
            setToken(null);
            // 清理本地会话并强制退出
            if (typeof clearSession === 'function') clearSession();
            if (typeof userDBDelete === 'function' && currentUser && currentUser.phone) {
              try { await userDBDelete(currentUser.phone); } catch(e) {}
            }
            currentUser = null;
            const msg = errMsg || '您的账号已被删除或禁用';
            setTimeout(() => {
              alert(msg + '，即将退出登录');
              if (typeof showLogin === 'function') showLogin();
              else location.reload();
            }, 0);
            throw new Error(msg);
          }

          // token 过期：尝试自动重新登录
          console.warn('[Cloud Sync] Token 无效或过期，尝试自动重新登录...');
          setToken(null);
          if (currentUser && currentUser.phone) {
            try {
              await cloudLogin(currentUser.phone, currentUser.password || '');
              const newToken = getToken();
              if (newToken) {
                finalOptions.headers['Authorization'] = 'Bearer ' + newToken;
                const retryResp = await fetch(url, { ...finalOptions, signal: controller.signal });
                const retryData = await retryResp.json();
                if (retryResp.ok) {
                  if (retryData.code === 200 && !retryData.success) retryData.success = true;
                  else if (retryData.success === true && !retryData.code) retryData.code = 200;
                  return retryData;
                }
              }
            } catch (loginErr) {
              console.error('[Cloud Sync] 自动重新登录失败:', loginErr.message);
            }
          }
          throw new Error('登录已过期，请重新登录');
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
// 后端根据 JWT token 中的用户身份返回项目（超管返回全部）
async function cloudGetProjects() {
  if (!getToken()) {
    // 无 token，尝试重新登录获取 token
    if (currentUser && currentUser.phone) {
      try {
        await cloudLogin(currentUser.phone, currentUser.password || '');
      } catch (e) {
        console.warn('[cloudGetProjects] 重新登录失败:', e.message);
      }
    }
    if (!getToken()) {
      console.warn('[cloudGetProjects] 无有效 token，无法获取云端项目');
      return [];
    }
  }

  const phone = getCurrentUserPhone();
  if (!phone) {
    console.warn('[cloudGetProjects] 缺少 phone 参数');
    return [];
  }

  const data = await cloudRequest(`/projects?phone=${encodeURIComponent(phone)}`);
  // 后端返回格式：{ code:200, data: { list: [...] } } 或 { code:200, data: [...] }
  let list = [];
  if (data && data.code === 200) {
    if (Array.isArray(data.data)) {
      list = data.data;  // 旧格式：data.data 是数组
    } else if (data.data && Array.isArray(data.data.list)) {
      list = data.data.list;  // 新格式：data.data.list 是数组
    } else if (Array.isArray(data.list)) {
      list = data.list;  // 备选格式
    }
  }
  // 将云端字段映射为本地格式，保持与本地项目数据结构兼容
  return list.map(p => ({
    id: p.id,
    name: p.name,
    desc: p.description || p.desc || '',
    description: p.description || p.desc || '',
    creator: p.creator_phone || p.creator || '',
    creator_phone: p.creator_phone || p.creator || '',
    creator_id: p.creator_id,
    status: p.status,
    visibility: p.is_public == 1 ? 'public' : 'private',
    is_public: p.is_public,
    memberPhones: p.memberPhones || [],
    member_count: p.member_count || 0,
    battle_count: p.battle_count || 0,
    battleRecordIds: p.battleRecordIds || [],
    created_at: p.created_at,
    updated_at: p.updated_at
  }));
}

// 获取单个项目详情（从云端），并做与 cloudGetProjects 一致的字段映射
async function cloudGetProject(projectId) {
  const data = await cloudRequest(`/projects/${projectId}`);
  const p = data.code === 200 ? data.data : (data.success ? data.data : null);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    desc: p.description || p.desc || '',
    description: p.description || p.desc || '',
    creator: p.creator_phone || p.creator || '',
    creator_phone: p.creator_phone || p.creator || '',
    creator_id: p.creator_id,
    status: p.status,
    visibility: p.is_public == 1 ? 'public' : 'private',
    is_public: p.is_public,
    memberPhones: p.memberPhones || [],
    member_count: p.member_count || 0,
    battle_count: p.battle_count || 0,
    battleRecordIds: p.battleRecordIds || [],
    created_at: p.created_at,
    updated_at: p.updated_at
  };
}

// ========== 用户管理 API ==========
async function cloudGetUsers() {
  try {
    const data = await cloudRequest('/users');
    const list = Array.isArray(data.data) ? data.data : ((data.data && data.data.list) || []);
    return list.map(u => ({
      phone: u.phone,
      name: u.nickname || u.name || '',
      role: u.role_id || u.role || 'member',
      avatar: u.avatar || '',
      status: u.status ?? 1,
      points: u.points || 0,
      createdAt: u.created_at ? new Date(u.created_at).getTime() : Date.now(),
      password: ''
    }));
  } catch (e) {
    console.error('[cloudGetUsers] 失败:', e);
    return [];
  }
}

// 更新用户积分（云端）- 使用 user_credits 表
async function cloudUpdateUserPoints(phone, points, options = {}) {
  try {
    const body = { phone, balance: points, ...options };
    const res = await cloudRequest(`/user_credits`, { method: 'PUT', body });
    return res.code === 200;
  } catch (e) {
    console.error('[cloudUpdateUserPoints] 失败:', e);
    return false;
  }
}

// 创建项目（云端）
async function cloudCreateProject(project) {
  // 统一字段名：前端用 desc/visibility/creator，后端用 description/is_public/creator_phone
  const body = {
    id:             project.id,
    name:           project.name,
    description:    project.desc || project.description || '',
    is_public:      (project.visibility === 'public' || project.is_public === 1) ? 1 : 0,
    creator_phone:  project.creator_phone || project.creator || '',
  };
  const data = await cloudRequest('/projects', { method: 'POST', body });
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
  return data.code === 200 ? (data.data || []) : [];
}

// 添加/更新项目成员（云端）
async function cloudAddProjectMember(projectId, phone, role = 'viewer', perms = {}) {
  const data = await cloudRequest(`/projects/${projectId}/members`, {
    method: 'POST',
    body: {
      phone, role,
      can_view: perms.canView,
      can_edit: perms.canEdit,
      can_delete: perms.canDelete,
      can_manage_members: perms.canMember,
      granted_by: perms.grantedBy
    }
  });
  return data.success;
}

// 更新项目成员权限（云端 PUT）
async function cloudUpdateProjectMember(projectId, phone, perms = {}) {
  const body = {};
  if (perms.canView !== undefined) body.can_view = perms.canView;
  if (perms.canEdit !== undefined) body.can_edit = perms.canEdit;
  if (perms.canDelete !== undefined) body.can_delete = perms.canDelete;
  if (perms.canMember !== undefined) body.can_manage_members = perms.canMember;
  if (perms.grantedBy !== undefined) body.granted_by = perms.grantedBy;
  const data = await cloudRequest(`/projects/${projectId}/members/${phone}`, {
    method: 'PUT',
    body
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
async function cloudGetRecords(projectId) {
  var url = '/battles';
  if (projectId) {
    url = '/battles?projectId=' + encodeURIComponent(projectId);
  }
  var resp = await cloudRequest(url);
  var list = [];
  if (resp && resp.code === 200) {
    if (Array.isArray(resp.data)) {
      list = resp.data;
    } else if (resp.data && Array.isArray(resp.data.list)) {
      list = resp.data.list;
    }
  }
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var bd = r.battleDate || r.battle_date || r.battleTime || '';
    out.push({
      id: r.id,
      projectId: (r.projectId !== undefined && r.projectId !== null) ? r.projectId : (r.project_id || null),
      battleDate: bd,
      time: bd ? new Date(bd).toLocaleString('zh-CN') : '',
      result: r.result || '',
      leftPlayer: r.attackerName || r.attacker_name || '',
      rightPlayer: r.enemyName || r.enemy_name || '',
      leftAlliance: r.leftAlliance || r.left_alliance || '',
      rightAlliance: r.rightAlliance || r.right_alliance || '',
      leftGeneral1:  r.left_general_1  || r.leftGeneral1  || '',
      leftGeneral2:  r.left_general_2  || r.leftGeneral2  || '',
      leftGeneral3:  r.left_general_3  || r.leftGeneral3  || '',
      rightGeneral1: r.right_general_1 || r.rightGeneral1 || '',
      rightGeneral2: r.right_general_2 || r.rightGeneral2 || '',
      rightGeneral3: r.right_general_3 || r.rightGeneral3 || '',
      leftTactic1_1: r.left_tactic_1_1 || r.leftTactic1_1 || '', leftTactic1_2: r.left_tactic_1_2 || r.leftTactic1_2 || '', leftTactic1_3: r.left_tactic_1_3 || r.leftTactic1_3 || '',
      leftTactic2_1: r.left_tactic_2_1 || r.leftTactic2_1 || '', leftTactic2_2: r.left_tactic_2_2 || r.leftTactic2_2 || '', leftTactic2_3: r.left_tactic_2_3 || r.leftTactic2_3 || '',
      leftTactic3_1: r.left_tactic_3_1 || r.leftTactic3_1 || '', leftTactic3_2: r.left_tactic_3_2 || r.leftTactic3_2 || '', leftTactic3_3: r.left_tactic_3_3 || r.leftTactic3_3 || '',
      rightTactic1_1: r.right_tactic_1_1 || r.rightTactic1_1 || '', rightTactic1_2: r.right_tactic_1_2 || r.rightTactic1_2 || '', rightTactic1_3: r.right_tactic_1_3 || r.rightTactic1_3 || '',
      rightTactic2_1: r.right_tactic_2_1 || r.rightTactic2_1 || '', rightTactic2_2: r.right_tactic_2_2 || r.rightTactic2_2 || '', rightTactic2_3: r.right_tactic_2_3 || r.rightTactic2_3 || '',
      rightTactic3_1: r.right_tactic_3_1 || r.rightTactic3_1 || '', rightTactic3_2: r.right_tactic_3_2 || r.rightTactic3_2 || '', rightTactic3_3: r.right_tactic_3_3 || r.rightTactic3_3 || '',
      leftFormation: r.leftFormation || r.left_formation || '',
      rightFormation: r.rightFormation || r.right_formation || '',
      leftLoss: (r.leftLoss !== undefined) ? r.leftLoss : ((r.left_loss !== undefined) ? r.left_loss : null),
      leftTotal: (r.leftTotal !== undefined) ? r.leftTotal : ((r.left_total !== undefined) ? r.left_total : null),
      rightLoss: (r.rightLoss !== undefined) ? r.rightLoss : ((r.right_loss !== undefined) ? r.right_loss : null),
      rightTotal: (r.rightTotal !== undefined) ? r.rightTotal : ((r.right_total !== undefined) ? r.right_total : null),
      leftLossRate: (r.leftLossRate !== undefined) ? r.leftLossRate : ((r.left_loss_rate !== undefined) ? r.left_loss_rate : null),
      rightLossRate: (r.rightLossRate !== undefined) ? r.rightLossRate : ((r.right_loss_rate !== undefined) ? r.right_loss_rate : null),
      description: r.description || '',
      imageBase64: r.imageBase64 || r.image_base64 || '',
      createdBy: (r.createdBy !== undefined) ? r.createdBy : ((r.created_by !== undefined) ? r.created_by : null),
      createdAt: r.createdAt || r.created_at || null,
      updatedAt: r.updatedAt || r.updated_at || null,
      status: (r.status !== undefined) ? r.status : 1,
      projectName: r.project_name || r.projectName || '',
      _synced: true,
      _syncTime: Date.now()
    });
  }
  return out;
}

// 创建战报（云端）- 排除大字段（图片等）
// 接收字段：projectId, battleDate, attackerName, enemyName, result, description
async function cloudCreateRecord(record) {
  const imageBase64 = record.imageBase64 || record.imageData || record.ocrImage || '';

  // 创建记录副本，排除大字段
  const recordForCloud = { ...record };
  delete recordForCloud.id;
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
  const result = data.code === 200 ? data.data : null;

  // 有图片则同步存入 battle_gallery
  if (imageBase64 && result && result.id) {
    try {
      await cloudRequest('/gallery', {
        method: 'POST',
        body: {
          battle_id: result.id,
          project_id: record.projectId || record.project_id,
          image_data: imageBase64,
          original_name: record.imageName || '',
          file_size: Math.round(imageBase64.length * 0.75),
          uploader_phone: record.uploaderPhone || record.user_phone || ''
        }
      });
    } catch (e) {
      console.warn('[Cloud] 图片同步失败（不影响战报）:', e.message);
    }
  }
  return result;
}

// 更新战报（云端）
// 注意：后端路由是 /battles，不是 /records
async function cloudUpdateRecord(recordId, recordData) {
  // 后端 PUT 接收 snake_case，前端存 camelCase，此处统一转换
  const body = {
    battle_date:    (recordData.battleDate || new Date().toISOString()).split('T')[0],
    attacker_name:  recordData.attackerName  || recordData.attacker_name  || '',
    enemy_name:     recordData.enemyName     || recordData.enemy_name     || '',
    left_alliance:  recordData.leftAlliance  || recordData.left_alliance  || '',
    right_alliance: recordData.rightAlliance || recordData.right_alliance || '',
    left_formation: recordData.leftFormation || recordData.left_formation || '',
    right_formation:recordData.rightFormation|| recordData.right_formation|| '',
    left_general_1: recordData.leftGeneral1 || '', left_general_2: recordData.leftGeneral2 || '', left_general_3: recordData.leftGeneral3 || '',
    right_general_1: recordData.rightGeneral1 || '', right_general_2: recordData.rightGeneral2 || '', right_general_3: recordData.rightGeneral3 || '',
    left_tactic_1_1: recordData.leftTactic1_1 || '', left_tactic_1_2: recordData.leftTactic1_2 || '', left_tactic_1_3: recordData.leftTactic1_3 || '',
    left_tactic_2_1: recordData.leftTactic2_1 || '', left_tactic_2_2: recordData.leftTactic2_2 || '', left_tactic_2_3: recordData.leftTactic2_3 || '',
    left_tactic_3_1: recordData.leftTactic3_1 || '', left_tactic_3_2: recordData.leftTactic3_2 || '', left_tactic_3_3: recordData.leftTactic3_3 || '',
    right_tactic_1_1: recordData.rightTactic1_1 || '', right_tactic_1_2: recordData.rightTactic1_2 || '', right_tactic_1_3: recordData.rightTactic1_3 || '',
    right_tactic_2_1: recordData.rightTactic2_1 || '', right_tactic_2_2: recordData.rightTactic2_2 || '', right_tactic_2_3: recordData.rightTactic2_3 || '',
    right_tactic_3_1: recordData.rightTactic3_1 || '', right_tactic_3_2: recordData.rightTactic3_2 || '', right_tactic_3_3: recordData.rightTactic3_3 || '',
    left_loss:      recordData.leftLoss      ?? recordData.left_loss      ?? recordData.leftDamage  ?? null,
    right_loss:     recordData.rightLoss     ?? recordData.right_loss     ?? recordData.rightDamage ?? null,
    left_total:     recordData.leftTotal     ?? recordData.left_total     ?? recordData.leftTroops  ?? null,
    right_total:    recordData.rightTotal    ?? recordData.right_total    ?? recordData.rightTroops ?? null,
    left_loss_rate: recordData.leftLossRate  ?? recordData.left_loss_rate ?? null,
    right_loss_rate:recordData.rightLossRate ?? recordData.right_loss_rate?? null,
    result:         recordData.result        || '',
    description:    recordData.description   || '',
  };
  const result = await cloudRequest(`/battles/${recordId}`, {
    method: 'PUT',
    body
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
async function cloudCreateUser(phone, name, password, role = 'member', avatar = '') {
  // 注意：此接口不需要 token，所以不能用 cloudRequest（会自动加 Authorization 头）
  const res = await fetch(`${CLOUD_API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, nickname: name, password, role, avatar })
  });
  const data = await res.json();
  return data.code === 200;
}

// ========== 战报管理（云端）==========
// 注意：所有创建/更新调用统一走 cloudCreateRecord / cloudUpdateRecord

const MERGE_MAP = {
  leftPlayer: ['leftPlayer', 'attackerName'], rightPlayer: ['rightPlayer', 'enemyName'],
  result: ['result'], leftAlliance: ['leftAlliance'], rightAlliance: ['rightAlliance'],
  leftFormation: ['leftFormation'], rightFormation: ['rightFormation'],
  description: ['description'],
  leftGeneral1: ['leftGeneral1'], leftGeneral2: ['leftGeneral2'], leftGeneral3: ['leftGeneral3'],
  rightGeneral1: ['rightGeneral1'], rightGeneral2: ['rightGeneral2'], rightGeneral3: ['rightGeneral3'],
  leftTactic1_1: ['leftTactic1_1'], leftTactic1_2: ['leftTactic1_2'], leftTactic1_3: ['leftTactic1_3'],
  leftTactic2_1: ['leftTactic2_1'], leftTactic2_2: ['leftTactic2_2'], leftTactic2_3: ['leftTactic2_3'],
  leftTactic3_1: ['leftTactic3_1'], leftTactic3_2: ['leftTactic3_2'], leftTactic3_3: ['leftTactic3_3'],
  rightTactic1_1: ['rightTactic1_1'], rightTactic1_2: ['rightTactic1_2'], rightTactic1_3: ['rightTactic1_3'],
  rightTactic2_1: ['rightTactic2_1'], rightTactic2_2: ['rightTactic2_2'], rightTactic2_3: ['rightTactic2_3'],
  rightTactic3_1: ['rightTactic3_1'], rightTactic3_2: ['rightTactic3_2'], rightTactic3_3: ['rightTactic3_3'],
  leftLoss: ['leftLoss'], rightLoss: ['rightLoss'], leftTotal: ['leftTotal'], rightTotal: ['rightTotal'],
  leftLossRate: ['leftLossRate'], rightLossRate: ['rightLossRate'], imageBase64: ['imageBase64'],
};

async function fetchGalleryImage(cloudId) {
  try {
    const data = await cloudRequest(`/gallery/by-battle/${cloudId}`);
    if (data.code === 200 && data.data && data.data.image_data) return data.data.image_data;
  } catch (e) { /* ignore */ }
  return null;
}

function mergeRecord(localRec, cloudRec) {
  for (const [cloudKey, localKeys] of Object.entries(MERGE_MAP)) {
    const cloudVal = cloudRec[cloudKey];
    if (!cloudVal && cloudVal !== 0) continue;
    for (const localKey of localKeys) {
      if (!localRec[localKey] || localRec[localKey] === '') {
        localRec[localKey] = cloudVal;
        break;
      }
    }
  }
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
    return false;
  }

  // 确保 IndexedDB 已打开（调用方可能未 await openDB）
  if (typeof openDB === 'function') {
    try { await openDB(); } catch(e) { console.warn('[Sync] openDB 失败:', e); }
  }

  try {
    // 1. 同步项目列表
    const cloudProjects = await cloudGetProjects();
    for (const proj of cloudProjects) {
      await projDBPut(proj);
    }

    // 2. 同步战报列表（增量同步：只同步有差异的战报）
    // 核心逻辑：云端记录（可能缺字段）不应覆盖本地有值记录
    try {
      const cloudRecords = await cloudGetRecords();
      let syncCount = 0;

      // ★ 关键优化：dbGetAll() 只调用一次，用 Map 做 O(1) 查找，避免 O(n²) 性能问题
      const allLocal = await dbGetAll();
      const byCloudId = new Map(allLocal.filter(r => r.cloudId).map(r => [String(r.cloudId), r]));
      // 业务 key：日期+左方+右方
      const bizKey = r => `${r.battleDate||''}|${r.leftPlayer||r.attackerName||''}|${r.rightPlayer||r.enemyName||''}`;
      const byBizKey = new Map(allLocal.map(r => [bizKey(r), r]));

      for (const rec of cloudRecords) {
        try {
          let localRec = null;

          // 3.1 按 cloudId 找本地记录
          const matched = byCloudId.get(String(rec.id));

          if (matched) {
            // 已有 cloudId 关联：直接用本地记录，用云端数据补全空字段
            localRec = matched;
            mergeRecord(localRec, rec);
            // 图片不在同步阶段拉取，由 syncProjectImages() 或溯源按需加载
            localRec._synced = true;
            localRec._syncTime = Date.now();
            await dbPutLocal(localRec);
          } else {
            // 3.2 按业务字段匹配（OCR 记录还没关联 cloudId）
            const cloudBizKey = `${rec.battleDate||''}|${rec.leftPlayer||''}|${rec.rightPlayer||''}`;
            const bizMatch = byBizKey.get(cloudBizKey);

            if (bizMatch) {
              localRec = bizMatch;
              localRec.cloudId = rec.id;
              mergeRecord(localRec, rec);
              // 图片不在同步阶段拉取
              localRec._synced = true;
              localRec._syncTime = Date.now();
              await dbPutLocal(localRec);
              // 更新内存索引
              byCloudId.set(String(rec.id), localRec);
              // 防止下一条相同 bizKey 的云端记录再次匹配同一本地记录（导致数据丢失）
              byBizKey.delete(cloudBizKey);
            } else {
              // 图片不在同步阶段拉取
              rec._synced = true;
              rec._syncTime = Date.now();
              rec.cloudId = rec.id;
              await dbPutLocal(rec);
              // 更新内存索引
              byCloudId.set(String(rec.id), rec);
              byBizKey.set(bizKey(rec), rec);
            }
          }

          syncCount++;
        } catch (e) {
          console.warn('[Sync] 战报同步失败（跳过）:', rec.id, e);
        }
      }

      // 4. 清理本地孤立记录：有 cloudId 但云端已删除的记录
      try {
        const cloudIdSet = new Set(cloudRecords.map(r => r.id));
        const allLocalAfterSync = await dbGetAll();
        let deletedCount = 0;
        for (const local of allLocalAfterSync) {
          if (local.cloudId && !cloudIdSet.has(local.cloudId)) {
            await dbDeleteLocal(local.id);
            deletedCount++;
          }
        }

        // 5. 汇总：打印最终本地 IndexedDB 中的记录情况（便于调试）
        const finalLocal = await dbGetAll();
        const byProject = {};
        for (const r of finalLocal) {
          const pid = r.projectId || 'none';
          byProject[pid] = (byProject[pid] || 0) + 1;
        }
      } catch (e) {
        console.warn('[Sync] 清理孤立记录失败（不影响主流程）:', e);
      }
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

// ========== 项目图片批量同步（仅 owner 调用）==========
// 遍历当前项目所有记录，逐条从 battle_gallery 拉取图片并写入 IndexedDB
// ========== 进入项目时全量同步该项目战报（解决历史截断遗留问题）==========
async function syncProjectRecords(projectId) {
  if (!projectId) return;
  try {
    console.log(`[syncProjectRecords] 拉取项目 ${projectId} 全量战报...`);
    const cloudRecords = await cloudGetRecords(projectId);
    if (!cloudRecords || !cloudRecords.length) return;

    // 先加载本地所有记录，按 cloudId 和 bizKey 建立索引，避免重复写入
    const allLocal = await dbGetAll();
    const byCloudId = new Map(allLocal.filter(r => r.cloudId).map(r => [String(r.cloudId), r]));
    const bizKey = r => `${r.battleDate||''}|${r.leftPlayer||r.attackerName||''}|${r.rightPlayer||r.enemyName||''}`;
    const byBizKey = new Map(allLocal.map(r => [bizKey(r), r]));

    let saved = 0;
    for (const rec of cloudRecords) {
      try {
        const cid = String(rec.id);
        const existing = byCloudId.get(cid);
        if (existing) {
          // 本地已有此 cloudId 的记录，跳过写入（节省 IndexedDB I/O）
          existing._synced = true;
          existing._syncTime = Date.now();
        } else {
          // 尝试 bizKey 匹配（处理 cloudId 尚未写回的孤立记录）
          const ck = bizKey(rec);
          const bizMatch = byBizKey.get(ck);
          if (bizMatch) {
            bizMatch.cloudId = rec.id;
            bizMatch._synced = true;
            bizMatch._syncTime = Date.now();
            await dbPutLocal(bizMatch);
            byCloudId.set(cid, bizMatch);
            // 防止相同 bizKey 的下一条云端记录再次匹配同一本地记录（导致数据丢失）
            byBizKey.delete(ck);
          } else {
            // 云端有、本地无 → 写入（rec.id 是 MySQL 主键，IndexedDB 用它做 key）
            rec.cloudId = rec.id;
            rec._synced = true;
            rec._syncTime = Date.now();
            await dbPutLocal(rec);
            byCloudId.set(cid, rec);
          }
        }
        saved++;
      } catch (e) {
        console.warn('[syncProjectRecords] 单条失败:', rec.id, e);
      }
    }
    // 同步删除：本地有 cloudId 且属于此项目，但云端已删的记录
    const cloudIdSet = new Set(cloudRecords.map(r => String(r.id)));
    const toDeleteLocal = allLocal.filter(r =>
      r.cloudId &&
      String(r.projectId) === String(projectId) &&
      !cloudIdSet.has(String(r.cloudId))
    );
    let deleted = 0;
    for (const local of toDeleteLocal) {
      try { await dbDeleteLocal(local.id); deleted++; } catch(e) {}
    }
    if (deleted > 0) console.log(`[syncProjectRecords] 同步删除 ${deleted} 条云端已删记录`);

    // 修复历史损坏状态：某些 cloudId 因 bizKey 碰撞被覆盖，导致云端记录在本地无对应项。
    // 循环检测并补写，直到所有云端 cloudId 都在本地存在（最多迭代 10 次防止死循环）
    let repaired = 0;
    for (let pass = 0; pass < 10; pass++) {
      const freshLocal = await dbGetAll();
      const freshCloudIds = new Set(
        freshLocal
          .filter(r => r.cloudId && String(r.projectId) === String(projectId))
          .map(r => String(r.cloudId))
      );
      const missing = cloudRecords.filter(r => !freshCloudIds.has(String(r.id)));
      if (missing.length === 0) break;
      for (const mr of missing) {
        try {
          mr.cloudId = mr.id;
          mr._synced = true;
          mr._syncTime = Date.now();
          await dbPutLocal(mr);
          repaired++;
        } catch(e) {}
      }
    }
    if (repaired > 0) console.log(`[syncProjectRecords] 修复 ${repaired} 条 bizKey 碰撞丢失记录`);

    console.log(`[syncProjectRecords] 完成，写入 ${saved}/${cloudRecords.length} 条，清理 ${deleted} 条，修复 ${repaired} 条`);
    return { saved, total: cloudRecords.length, deleted, repaired };
  } catch (e) {
    console.warn('[syncProjectRecords] 失败:', e);
  }
}

async function syncProjectImages(projectId) {
  if (!projectId) return;
  if (typeof dbGetAll !== 'function' || typeof dbPutLocal !== 'function') return;
  try {
    const all = await dbGetAll();
    const targets = all.filter(r => String(r.projectId) === String(projectId) && !r.imageBase64 && r.cloudId);
    if (!targets.length) return;
    console.log(`[syncProjectImages] 开始拉取 ${targets.length} 条记录图片...`);
    let done = 0;
    for (const rec of targets) {
      try {
        const img = await fetchGalleryImage(rec.cloudId);
        if (img) {
          rec.imageBase64 = img;
          await dbPutLocal(rec);
          done++;
        }
      } catch (e) { /* 单条失败不影响整体 */ }
    }
    console.log(`[syncProjectImages] 完成，共加载 ${done} 张图片`);
    // 图片加载完成后刷新图库显示
    if (typeof renderGallery === 'function') renderGallery();
    if (typeof loadAllRecords === 'function') {
      await loadAllRecords();
    }
  } catch (e) {
    console.warn('[syncProjectImages] 失败:', e);
  }
}

window.cloudSync = {
  getProjects: cloudGetProjects,
  createProject: cloudCreateProject,
  updateProject: cloudUpdateProject,
  deleteProject: cloudDeleteProject,
  getProjectMembers: cloudGetProjectMembers,
  addProjectMember: cloudAddProjectMember,
  updateProjectMember: cloudUpdateProjectMember,
  removeProjectMember: cloudRemoveProjectMember,
  getRecords: cloudGetRecords,
  createRecord: cloudCreateRecord,
  updateRecord: cloudUpdateRecord,
  deleteRecord: cloudDeleteRecord,
  getProject: cloudGetProject,
  login: cloudLogin,
  createUser: cloudCreateUser,
  syncToLocal: syncCloudToLocal,
  syncProjectRecords: syncProjectRecords,
  syncProjectImages: syncProjectImages,
  request: cloudRequestAPI,
  setToken: setToken,
  getToken: getToken,
  getMyAccess: cloudGetMyAccess,
  getUsers: cloudGetUsers,
  getStorageStats: cloudGetStorageStats,
  updateUserPoints: cloudUpdateUserPoints,
  getDBTables: cloudGetDBTables,
  queryTable: cloudQueryTable,
  describeTable: cloudDescribeTable,
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

// ========== 数据库查看 API（仅超管） ==========

async function cloudGetDBTables() {
  try {
    const data = await cloudRequest('/db/tables');
    if (data && data.code === 200 && data.data) return data.data;
    return null;
  } catch (e) {
    console.error('[cloudGetDBTables] 失败:', e);
    return null;
  }
}

async function cloudQueryTable(tableName, params) {
  const qs = new URLSearchParams(params || {}).toString();
  try {
    const data = await cloudRequest(`/db/table/${tableName}?${qs}`);
    if (data && data.code === 200 && data.data) return data.data;
    return null;
  } catch (e) {
    console.error('[cloudQueryTable] 失败:', e);
    return null;
  }
}

async function cloudDescribeTable(tableName) {
  try {
    const data = await cloudRequest(`/db/table/${tableName}/desc`);
    if (data && data.code === 200 && data.data) return data.data;
    return null;
  } catch (e) {
    console.error('[cloudDescribeTable] 失败:', e);
    return null;
  }
}

/* ==========================================================
   DATA PERM - 数据权限管理（重构版 V2）
   ========================================================== */


// ========== projAccess 新数据结构 ==========
// {
//   id: phone + '_' + projectId,
//   phone,
//   projectId,
//   grantedBy,
//   grantedAt,
//   canEdit: false,    // 可编辑项目信息
//   canDelete: false    // 可删除项目
// }
// 注："成员"权限仍通过 project.memberPhones 控制

const PROJ_ACCESS_DB = 'projAccess';

function openPermDB() {
  return openUserDB();
}

// ========== DB 操作 ==========
async function permDBGetAll() {
  const db = await openPermDB();
  if (!db.objectStoreNames.contains(PROJ_ACCESS_DB)) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROJ_ACCESS_DB], 'readonly');
    const req = tx.objectStore(PROJ_ACCESS_DB).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function permDBGetByProject(projectId) {
  const all = await permDBGetAll();
  return all.filter(a => a.projectId === projectId);
}

async function permDBPut(entry) {
  const db = await openPermDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROJ_ACCESS_DB], 'readwrite');
    const req = tx.objectStore(PROJ_ACCESS_DB).put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function permDBDelete(id) {
  const db = await openPermDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROJ_ACCESS_DB], 'readwrite');
    const req = tx.objectStore(PROJ_ACCESS_DB).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ========== 授权判断（供 getVisibleProjects 调用）==========
let _permCacheUser = null;
let _permCacheSet = null;

async function getGrantedProjectIds(phone) {
  if (_permCacheUser === phone && _permCacheSet) return _permCacheSet;
  const entries = await permDBGetByPhone(phone);
  _permCacheSet = new Set(entries.map(e => e.projectId));
  _permCacheUser = phone;
  return _permCacheSet;
}

function clearPermCache() {
  _permCacheUser = null;
  _permCacheSet = null;
}

// 兼容：按 phone 查询
async function permDBGetByPhone(phone) {
  const all = await permDBGetAll();
  return all.filter(a => a.phone === phone);
}

// 获取某用户的所有 projAccess 记录（供其他模块调用）
async function getProjAccessForUser(phone) {
  return await permDBGetByPhone(phone);
}

// ========== 覆盖 getVisibleProjects（云端为真相之源）==========
window.getVisibleProjects = async function (options = {}) {
  if (!currentUser) return [];

  const localProjects = await projDBGetAll();
  let merged = new Map();
  for (const p of localProjects) { merged.set(p.id, p); }

  if (options.cacheOnly) {
    const cached = Array.from(merged.values());
    if (currentUser.role === 'super_admin') return cached;
    return cached.filter(p =>
      p.visibility === 'public' || p.is_public == 1 ||
      p.creator === currentUser.phone || p.creator_phone === currentUser.phone ||
      (p.memberPhones || []).includes(currentUser.phone)
    );
  }

  // cloudIds = 后端按权限过滤后返回的项目ID集合
  let cloudIds = new Set();
  let cloudFetchSuccess = false; // 标记云端是否成功响应
  if (window.cloudSync && window.cloudSync.getProjects) {
    try {
      const cloudProjects = await window.cloudSync.getProjects();
      console.log('[Cloud] data-perm 获取云端项目:', cloudProjects.length, '个');
      for (const proj of cloudProjects) {
        cloudIds.add(String(proj.id));
        await projDBPut(proj);
        merged.set(proj.id, proj); // 云端始终覆盖本地
      }
      cloudFetchSuccess = true;

      // 清理本地有但云端没有的项目（所有用户生效，不限超管）
      // 云端是唯一真相源：不在云端 = 已被删除，清理本地缓存防止幽灵项目
      for (const [id, p] of new Map(merged)) {
        if (!cloudIds.has(String(id))) {
          console.log('[Cloud] 项目', p.name, '(', id, ') 在云端不存在，从本地清理');
          await projDBDelete(id);
          merged.delete(id);
        }
      }
    } catch (e) {
      console.error('[Cloud] 获取云端项目失败，使用本地数据:', e.message || e);
    }
  }

  const all = Array.from(merged.values());
  if (currentUser.role === 'super_admin') return all;

  // 云端响应成功：以云端权限为唯一依据，防止显示幽灵项目
  if (cloudFetchSuccess) {
    return all.filter(p => cloudIds.has(String(p.id)));
  }

  // 云端响应失败（离线模式）：回退本地缓存判断
  const grantedIds = await getGrantedProjectIds(currentUser.phone);
  return all.filter(p =>
    p.visibility === 'public' || p.is_public == 1 ||
    p.creator === currentUser.phone || p.creator_phone === currentUser.phone ||
    (p.memberPhones || []).includes(currentUser.phone) ||
    grantedIds.has(p.id) || grantedIds.has(String(p.id))
  );
};

// ========== 渲染数据权限页面（新 UI）==========
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' 超时')), ms))
  ]);
}

async function renderDataPerm() {
  const container = document.getElementById('dataPermContent');
  if (!container) return;

  // 全局 10 秒兜底超时：无论哪里卡住，10 秒后一定渲染内容或错误
  const finish = (html) => {
    if (document.getElementById('dataPermContent')) {
      document.getElementById('dataPermContent').innerHTML = html;
    }
  };
  const globalTimeout = setTimeout(() => {
    console.error('[renderDataPerm] 全局 10 秒超时，强制渲染');
    finish('<div style="padding:40px;text-align:center;color:#ff5252;">⚠️ 加载超时，请刷新重试</div>');
  }, 10000);

  try {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text2);">⏳ 加载中...</div>';
    console.log('[renderDataPerm] 开始渲染，currentUser:', currentUser?.phone, currentUser?.role);

    // 按权限点 dataperm 控制访问（超级管理员自动拥有所有权限）
    if (!currentUser) {
      console.log('[renderDataPerm] currentUser 为空，未登录');
      clearTimeout(globalTimeout);
      finish(`<div style="padding:40px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">⛔</div>
        <div style="color:var(--text);font-size:14px;font-weight:bold;margin-bottom:8px;">请先登录</div>
      </div>`);
      return;
    }

    // 获取权限（带 5 秒超时）
    let perms;
    try {
      perms = await withTimeout(getRolePermissions(currentUser.role), 5000, 'getRolePermissions');
      console.log('[renderDataPerm] 权限获取成功:', Object.keys(perms || {}).length, '个权限点');
    } catch(e) {
      console.warn('[renderDataPerm] getRolePermissions 失败，使用兜底:', e.message);
      perms = { dataperm: true }; // 兜底：超时不拒绝访问
    }

    if (!perms || !perms['dataperm']) {
      console.log('[renderDataPerm] 无 dataperm 权限');
      clearTimeout(globalTimeout);
      finish(`<div style="padding:40px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">⛔</div>
        <div style="color:var(--text);font-size:14px;font-weight:bold;margin-bottom:8px;">当前角色无权访问数据权限配置</div>
        <div style="color:var(--text3);font-size:12px;">请联系管理员分配「数据权限」权限点</div>
      </div>`);
      return;
    }

    // 加载项目和用户数据（各带 5 秒超时）
    let allProjects = [], allUsers = [];
    try {
      const [projs, users] = await Promise.all([
        withTimeout(projDBGetAll(), 5000, 'projDBGetAll'),
        withTimeout(userDBGetAll(), 5000, 'userDBGetAll')
      ]);
      allProjects = projs || [];
      allUsers = users || [];
      console.log('[renderDataPerm] 数据加载完成，项目:', allProjects.length, '用户:', allUsers.length);
    } catch (err) {
      console.error('[renderDataPerm] 数据加载失败:', err.message);
      clearTimeout(globalTimeout);
      finish(`<div style="padding:40px;text-align:center;color:#ff5252;">❌ 数据加载失败：${err.message}</div>`);
      return;
    }

    const normalUsers = allUsers.filter(u => u.role !== 'super_admin');

    let html = `
    <div style="padding:20px 28px;">
      <div style="background:linear-gradient(135deg,var(--card),rgba(26,32,56,.8));border-radius:var(--radius);border:1px solid var(--border);padding:20px 24px;box-shadow:0 4px 20px rgba(0,0,0,.2);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <h3 style="margin:0;color:var(--accent);font-size:15px;">🔐 数据权限配置</h3>
          <span style="font-size:11px;color:var(--text3);">共 ${allProjects.length} 个项目 · ${normalUsers.length} 个普通用户</span>
        </div>
        <p style="font-size:12px;color:var(--text2);margin:0 0 20px 0;padding-bottom:12px;border-bottom:1px solid var(--border);">
          点击「管理权限」为指定用户分配本项目的访问、编辑和删除权限。<br>
          默认规则：用户可访问自己创建的项目、被加入成员的项目、以及公开项目。
        </p>`;

    if (allProjects.length === 0) {
      html += '<div style="padding:32px;text-align:center;color:var(--text3);">暂无项目</div>';
    } else {
      for (const proj of allProjects) {
        const isPublic = proj.visibility === 'public';
        const creatorUser = allUsers.find(u => u.phone === proj.creator);
        const creatorName = creatorUser ? (creatorUser.name || proj.creator) : proj.creator;
        const memberCount = (proj.memberPhones || []).length;

        html += `
          <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg2);">
            <div style="background:var(--bg3);padding:10px 16px;display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="font-weight:bold;color:var(--text);font-size:13px;">${escHtml(proj.name)}</span>
                <span style="font-size:10px;padding:2px 8px;border-radius:4px;${isPublic ? 'background:rgba(81,207,102,.12);color:var(--green);' : 'background:rgba(255,107,107,.1);color:var(--red);'}">${isPublic ? '🌐 公开' : '🔒 私有'}</span>
                <span style="font-size:11px;color:var(--text3);">创建者：${escHtml(creatorName)}</span>
                <span style="font-size:11px;color:var(--text3);">${memberCount} 成员 · ${(proj.battleRecordIds || []).length} 战报</span>
              </div>
              <button onclick="showProjectPermModal('${proj.id}')" style="padding:5px 14px;border-radius:6px;border:1px solid var(--accent);background:rgba(240,180,41,.08);color:var(--accent);cursor:pointer;font-size:12px;font-weight:bold;">⚙️ 管理权限</button>
            </div>
          </div>`;
      }
    }

    html += `
    </div>
  </div>`;

  clearTimeout(globalTimeout);
  finish(html);
  } catch(e) {
    clearTimeout(globalTimeout);
    console.error('[renderDataPerm] 渲染异常:', e.message || e);
    finish(`<div style="padding:40px;text-align:center;color:#ff5252;">❌ 页面加载异常：${e.message || e}</div>`);
  }
}

// ========== 弹窗：管理项目权限 ==========
async function showProjectPermModal(projectId) {
  // 权限检查：需要 dataperm 权限
  if (!currentUser) { alert('请先登录'); return; }
  const perms = await getRolePermissions(currentUser.role);
  if (!perms || !perms['dataperm']) { alert('无权操作：需要「数据权限」权限'); return; }

  const allProjects = await projDBGetAll();
  const allUsers = await userDBGetAll();
  // 类型兼容：proj.id 可能是数字或字符串
  const proj = allProjects.find(p => p.id == projectId || String(p.id) === String(projectId) || Number(p.id) === Number(projectId));
  if (!proj) { alert('项目不存在'); return; }

  const normalUsers = allUsers.filter(u => u.role !== 'super_admin');
  const accessList = await permDBGetByProject(projectId);

  // 构建现有权限映射
  const permMap = {};
  for (const a of accessList) {
    permMap[a.phone] = { canView: a.canView, canEdit: a.canEdit, canDelete: a.canDelete, canMember: a.canMember };
  }

  // 渲染弹窗
  let usersHtml = '';
  for (const u of normalUsers) {
    const isCreator = u.phone === proj.creator || u.phone === proj.creator_phone;
    const isMember = (proj.memberPhones || []).includes(u.phone);
    let badge = '';
    let disabled = false;
    if (isCreator) {
      badge = '<span style="font-size:10px;color:var(--green);">创建者（自动有编辑/删除权）</span>';
      disabled = true;
    } else if (isMember) {
      badge = '<span style="font-size:10px;color:var(--accent);">项目成员（可访问）</span>';
      disabled = true;
    }

    const perm = permMap[u.phone] || {};
    // 成员和创建者自动拥有可见权限（不可取消）
    const autoView = isCreator || isMember;
    const canViewChecked = autoView || perm.canView ? 'checked' : '';
    const canViewDisabled = autoView ? 'disabled' : '';
    const canEdit = perm.canEdit ? 'checked' : '';
    const canDelete = perm.canDelete ? 'checked' : '';
    const canMember = perm.canMember ? 'checked' : '';

    // 用户行是否已在权限记录中（成员 OR 有显式权限记录）
    const isMemberChecked = isMember ? 'checked' : (permMap[u.phone] ? 'checked' : '');
    usersHtml += `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);">
        <input type="checkbox" class="dp-user-check" data-phone="${u.phone}" ${isMemberChecked} ${disabled ? 'disabled' : ''} style="accent-color:var(--accent);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:var(--text);">${escHtml(u.name || '未命名')}</div>
          <div style="font-size:10px;color:var(--text3);">${escHtml(u.phone)}</div>
        </div>
        <div style="display:flex;gap:8px;font-size:11px;color:var(--text2);">
          <label style="display:flex;align-items:center;gap:3px;cursor:${autoView?'default':'pointer'};" title="${autoView?'成员自动拥有可见权限':'允许该用户看到此项目'}">
            <input type="checkbox" class="dp-perm-view" data-phone="${u.phone}" ${canViewChecked} ${canViewDisabled} style="accent-color:#0ea5e9;"> 可见
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
            <input type="checkbox" class="dp-perm-member" data-phone="${u.phone}" ${isMemberChecked} style="accent-color:var(--accent);"> 成员
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
            <input type="checkbox" class="dp-perm-edit" data-phone="${u.phone}" ${canEdit} style="accent-color:var(--accent);"> 编辑
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
            <input type="checkbox" class="dp-perm-del" data-phone="${u.phone}" ${canDelete} style="accent-color:var(--red);"> 删除
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;" title="允许该用户管理此项目的成员列表">
            <input type="checkbox" class="dp-perm-mgr" data-phone="${u.phone}" ${canMember} style="accent-color:#7c3aed;"> 管成员
          </label>
        </div>
        ${badge ? '<div style="min-width:100px;text-align:right;">' + badge + '</div>' : ''}
      </div>`;
  }

  const modal = document.createElement('div');
  modal.className = 'dp-modal-overlay';
  modal.innerHTML = `
    <div class="dp-modal-panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h3 style="margin:0;color:var(--accent);font-size:15px;">🔐 权限管理 — ${escHtml(proj.name)}</h3>
        <span class="dp-modal-close" onclick="this.closest('.dp-modal-overlay').remove()">✕</span>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px;">勾选用户并选择权限，点击确认保存</div>
      <div style="max-height:50vh;overflow-y:auto;margin-bottom:16px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);">
        ${usersHtml || '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">暂无普通用户</div>'}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="dp-btn-cancel" onclick="this.closest('.dp-modal-overlay').remove()">取消</button>
        <button class="dp-btn-confirm" onclick="saveProjectPermissions('${projectId}')">确认保存</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ========== 保存项目权限 ==========
async function saveProjectPermissions(projectId) {
  // 权限检查：需要 dataperm 权限
  if (!currentUser) { alert('请先登录'); return; }
  const perms = await getRolePermissions(currentUser.role);
  if (!perms || !perms['dataperm']) { alert('无权操作：需要「数据权限」权限'); return; }

  // 收集勾选的用户
  const checkboxes = document.querySelectorAll('.dp-user-check:checked:not(:disabled)');
  const phones = [...checkboxes].map(cb => cb.dataset.phone);

  // 收集权限
  const permView = {};
  document.querySelectorAll('.dp-perm-view:checked').forEach(cb => { permView[cb.dataset.phone] = true; });
  const permMember = {};
  document.querySelectorAll('.dp-perm-member:checked').forEach(cb => { permMember[cb.dataset.phone] = true; });
  const permEdit = {};
  document.querySelectorAll('.dp-perm-edit:checked').forEach(cb => { permEdit[cb.dataset.phone] = true; });
  const permDel = {};
  document.querySelectorAll('.dp-perm-del:checked').forEach(cb => { permDel[cb.dataset.phone] = true; });
  const permMgr = {};
  document.querySelectorAll('.dp-perm-mgr:checked').forEach(cb => { permMgr[cb.dataset.phone] = true; });

  // 读取项目
  const proj = await projDBGet(projectId);
  if (!proj) { alert('项目不存在'); return; }

  // 更新成员列表（成员复选框 → project.memberPhones）
  // 构建新成员列表：创建者 + 所有勾选了"成员"的用户
  let memberPhones = [proj.creator].filter(Boolean);
  for (const phone of Object.keys(permMember)) {
    if (permMember[phone] && phone !== proj.creator) {
      memberPhones.push(phone);
    }
  }
  proj.memberPhones = [...new Set(memberPhones)];
  await projDBPut(proj);

  // 同步成员变更到云端（通过项目成员 API，含细粒度权限）
  if (window.cloudSync) {
    try {
      const cloudMembers = await window.cloudSync.getProjectMembers(projectId);
      const cloudPhones = (cloudMembers || []).map(m => m.phone);

      // 构建权限映射（包含成员，主复选框 disabled 者也在内）
      const permGrants = {};
      const allCloudPhones = new Set([...phones, ...memberPhones]);
      for (const map of [permEdit, permDel, permMgr]) {
        for (const phone of Object.keys(map)) {
          if (map[phone]) allCloudPhones.add(phone);
        }
      }
      for (const phone of allCloudPhones) {
        permGrants[phone] = {
          canView: (proj.memberPhones || []).includes(phone) || !!permView[phone],
          canEdit: !!permEdit[phone],
          canDelete: !!permDel[phone],
          canMember: !!permMgr[phone],
          grantedBy: currentUser.phone
        };
      }

      // 添加新成员到云端（含权限字段）
      for (const phone of memberPhones) {
        if (phone !== proj.creator && !cloudPhones.includes(phone)) {
          await window.cloudSync.addProjectMember(projectId, phone, 'viewer', permGrants[phone] || {});
        }
      }
      // 更新已有成员的权限
      for (const cm of cloudMembers || []) {
        if (cm.phone && memberPhones.includes(cm.phone) && permGrants[cm.phone]) {
          await window.cloudSync.updateProjectMember(projectId, cm.phone, permGrants[cm.phone]);
        }
      }
      // 从云端删除移除的成员
      for (const cm of cloudMembers || []) {
        if (!memberPhones.includes(cm.phone)) {
          await window.cloudSync.removeProjectMember(projectId, cm.phone);
        }
      }
    } catch (e) {
      console.error('[DataPerm] 云端同步失败（本地已保存）:', e);
    }
  }

  // 先删除本项目所有旧权限（projAccess）
  const oldAccess = await permDBGetByProject(projectId);
  for (const a of oldAccess) {
    await permDBDelete(a.id);
  }

  // 写入新权限：成员 OR 有任意显式权限的用户都写入 projAccess
  // 合并所有在任意权限复选框中出现的 phone（包括成员/创建者，其主复选框可能 disabled 而不在 phones 中）
  const allPermPhones = new Set([...phones]);
  for (const map of [permView, permMember, permEdit, permDel, permMgr]) {
    for (const phone of Object.keys(map)) {
      if (map[phone]) allPermPhones.add(phone);
    }
  }
  // 也加入项目当前的所有成员（成员自动有可见权限，需保留在 projAccess 中）
  for (const phone of (proj.memberPhones || [])) {
    allPermPhones.add(phone);
  }

  for (const phone of allPermPhones) {
    const isMember = (proj.memberPhones || []).includes(phone);
    const hasAnyPerm = isMember || permView[phone] || permEdit[phone] || permDel[phone] || permMgr[phone];
    if (!hasAnyPerm) continue;
    await permDBPut({
      id: phone + '_' + projectId,
      phone,
      projectId,
      grantedBy: currentUser.phone,
      grantedAt: Date.now(),
      canView: isMember || !!permView[phone],
      canEdit: !!permEdit[phone],
      canDelete: !!permDel[phone],
      canMember: !!permMgr[phone]
    });
  }

  addSysLog('action', `更新数据权限: 项目 ${proj.name||projectId}，授权 ${phones.length} 个用户`);
  clearPermCache();

  // 关闭弹窗并刷新
  document.querySelector('.dp-modal-overlay')?.remove();
  await renderDataPerm();
  alert('权限保存成功！');
}

// 判断某用户是否对某项目有删除权限
async function canUserDeleteProject(phone, projectId) {
  if (!phone || !projectId) return false;
  const user = await userDBGet(phone);
  if (user && user.role === 'super_admin') return true;
  const proj = await projDBGet(projectId);
  if (proj && proj.creator === phone) return true;
  const all = await permDBGetAll();
  const entry = all.find(a => a.phone === phone && (a.projectId == projectId || String(a.projectId) === String(projectId)));
  return !!(entry && entry.canDelete);
}

// ========== CSS 注入 ==========
(function injectDPModalCSS(){
  if (document.getElementById('dpModalCSS')) return;
  const style = document.createElement('style');
  style.id = 'dpModalCSS';
  style.textContent = `
    .dp-modal-overlay{
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,.7);backdrop-filter:blur(6px);
      z-index:10003;display:flex;align-items:center;justify-content:center;
      animation:fadeIn .2s;
    }
    .dp-modal-panel{
      background:linear-gradient(135deg,#151a2e,#1a2040);
      border:1px solid rgba(240,180,41,.3);border-radius:14px;
      padding:24px;max-width:640px;width:92vw;
      box-shadow:0 8px 48px rgba(0,0,0,.5);
      animation:slideUp .25s ease-out;max-height:85vh;overflow-y:auto;
    }
    .dp-modal-close{
      cursor:pointer;font-size:18px;color:var(--text3);
      transition:color .2s;flex-shrink:0;
    }
    .dp-modal-close:hover{color:var(--red);}
    .dp-btn-cancel{
      padding:8px 20px;border-radius:6px;border:1px solid var(--border);
      background:var(--bg3);color:var(--text2);cursor:pointer;font-size:12px;
    }
    .dp-btn-cancel:hover{background:var(--bg2);color:var(--text);}
    .dp-btn-confirm{
      padding:8px 20px;border-radius:6px;border:none;
      background:linear-gradient(135deg,var(--accent),#e6a817);
      color:#0d1025;font-weight:bold;cursor:pointer;font-size:12px;
    }
    .dp-btn-confirm:hover{opacity:.88;}
    @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
    @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
  `;
  document.head.appendChild(style);
})();

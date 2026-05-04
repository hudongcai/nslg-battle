/* ==========================================================
   DATA PERM - 数据权限管理（重构版 V2）
   ========================================================== */

console.log('[DataPerm] data-perm.js V2 开始加载');

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

const PROJ_ACCESS_STORE = 'projAccess';

function openPermDB() {
  return openUserDB();
}

// ========== DB 操作 ==========
async function permDBGetAll() {
  const db = await openPermDB();
  if (!db.objectStoreNames.contains(PROJ_ACCESS_STORE)) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROJ_ACCESS_STORE], 'readonly');
    const req = tx.objectStore(PROJ_ACCESS_STORE).getAll();
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
    const tx = db.transaction([PROJ_ACCESS_STORE], 'readwrite');
    const req = tx.objectStore(PROJ_ACCESS_STORE).put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function permDBDelete(id) {
  const db = await openPermDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROJ_ACCESS_STORE], 'readwrite');
    const req = tx.objectStore(PROJ_ACCESS_STORE).delete(id);
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

// ========== 扩展 getVisibleProjects（修复：优先从云端获取）==========
window._origGetVisibleProjects = window.getVisibleProjects || null;

window.getVisibleProjects = async function () {
  if (!currentUser) return [];
  
  // 优先从云端获取项目列表
  let all = [];
  // 修复：先检查 token 是否存在，无 token 时不调用云端 API
  if (window.cloudSync && window.cloudSync.getToken && window.cloudSync.getToken()) {
    try {
      const cloudProjects = await window.cloudSync.getProjects();
      console.log('[Cloud] data-perm 获取云端项目:', cloudProjects.length, '个');
      // 同步到本地 IndexedDB（作为缓存）
      for (const proj of cloudProjects) {
        await projDBPut(proj);
      }
      all = cloudProjects;
    } catch (e) {
      console.error('[Cloud] 获取云端项目失败，使用本地数据:', e.message || e);
    }
  } else {
    console.log('[Cloud] 无有效 token，跳过云端获取，使用本地数据');
  }
  
  // 如果云端没有数据，fallback 到本地 IndexedDB
  if (all.length === 0) {
    all = await projDBGetAll();
  }
  
  // 超管返回全部项目
  if (currentUser.role === 'super_admin') return all;
  
  // 普通用户需要过滤权限
  const grantedIds = await getGrantedProjectIds(currentUser.phone);
  return all.filter(p =>
    p.visibility === 'public' ||
    p.creator === currentUser.phone ||
    (p.memberPhones || []).includes(currentUser.phone) ||
    grantedIds.has(p.id)
  );
};

// ========== 渲染数据权限页面（新 UI）==========
async function renderDataPerm() {
  const container = document.getElementById('dataPermContent');
  if (!container) return;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text2);">⏳ 加载中...</div>';

  if (!currentUser || currentUser.role !== 'super_admin') {
    container.innerHTML = `<div style="padding:40px;text-align:center;">
      <div style="font-size:32px;margin-bottom:12px;">⛔</div>
      <div style="color:var(--text);font-size:14px;font-weight:bold;margin-bottom:8px;">仅超级管理员可访问数据权限配置</div>
    </div>`;
    return;
  }

  let allProjects = [], allUsers = [];
  try {
    [allProjects, allUsers] = await Promise.all([projDBGetAll(), userDBGetAll()]);
  } catch (err) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#ff5252;">❌ 数据加载失败：${err.message}</div>`;
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
      <div style="margin-top:16px;padding:12px 14px;background:rgba(116,192,252,.04);border:1px solid rgba(116,192,252,.15);border-radius:8px;font-size:11px;color:var(--text2);">
        💡 <b style="color:var(--blue);">说明</b>：「成员」权限在项目管理的成员按钮中设置；此处管理额外的访问、编辑、删除权限。
      </div>
    </div>
  </div>`;

  container.innerHTML = html;
}

// ========== 弹窗：管理项目权限 ==========
async function showProjectPermModal(projectId) {
  const allProjects = await projDBGetAll();
  const allUsers = await userDBGetAll();
  const proj = allProjects.find(p => p.id === projectId);
  if (!proj) { alert('项目不存在'); return; }

  const normalUsers = allUsers.filter(u => u.role !== 'super_admin');
  const accessList = await permDBGetByProject(projectId);

  // 构建现有权限映射
  const permMap = {};
  for (const a of accessList) {
    permMap[a.phone] = { canEdit: a.canEdit, canDelete: a.canDelete };
  }

  // 渲染弹窗
  let usersHtml = '';
  for (const u of normalUsers) {
    const isCreator = u.phone === proj.creator;
    const isMember = (proj.memberPhones || []).includes(u.phone);
    let badge = '';
    let disabled = false;
    if (isCreator) {
      badge = '<span style="font-size:10px;color:var(--green);">创建者（自动有权）</span>';
      disabled = true;
    } else if (isMember) {
      badge = '<span style="font-size:10px;color:var(--accent);">项目成员（自动有权）</span>';
      disabled = true;
    }

    const checked = permMap[u.phone] ? 'checked' : '';
    const canEdit = permMap[u.phone] && permMap[u.phone].canEdit ? 'checked' : '';
    const canDelete = permMap[u.phone] && permMap[u.phone].canDelete ? 'checked' : '';

    const isMemberChecked = (proj.memberPhones || []).includes(u.phone) ? 'checked' : (permMap[u.phone] ? 'checked' : '');
    usersHtml += `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);">
        <input type="checkbox" class="dp-user-check" data-phone="${u.phone}" ${isMemberChecked} ${disabled ? 'disabled' : ''} style="accent-color:var(--accent);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:var(--text);">${escHtml(u.name || '未命名')}</div>
          <div style="font-size:10px;color:var(--text3);">${escHtml(u.phone)}</div>
        </div>
        <div style="display:flex;gap:10px;font-size:11px;color:var(--text2);">
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
            <input type="checkbox" class="dp-perm-member" data-phone="${u.phone}" ${isMemberChecked} style="accent-color:var(--accent);"> 成员
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
            <input type="checkbox" class="dp-perm-edit" data-phone="${u.phone}" ${canEdit} style="accent-color:var(--accent);"> 编辑
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
            <input type="checkbox" class="dp-perm-del" data-phone="${u.phone}" ${canDelete} style="accent-color:var(--red);"> 删除
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
  // 收集勾选的用户
  const checkboxes = document.querySelectorAll('.dp-user-check:checked:not(:disabled)');
  const phones = [...checkboxes].map(cb => cb.dataset.phone);

  // 收集权限
  const permMember = {};
  document.querySelectorAll('.dp-perm-member:checked').forEach(cb => { permMember[cb.dataset.phone] = true; });
  const permEdit = {};
  document.querySelectorAll('.dp-perm-edit:checked').forEach(cb => { permEdit[cb.dataset.phone] = true; });
  const permDel = {};
  document.querySelectorAll('.dp-perm-del:checked').forEach(cb => { permDel[cb.dataset.phone] = true; });

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
  await projDBPut(proj);

  // 先删除本项目所有旧权限（projAccess）
  const oldAccess = await permDBGetByProject(projectId);
  for (const a of oldAccess) {
    await permDBDelete(a.id);
  }

  // 写入新权限（仅对勾选了"成员"的用户写入 projAccess 记录，用于记录编辑/删除权限）
  for (const phone of phones) {
    if (!permMember[phone]) continue; // 未勾选成员的不写入
    await permDBPut({
      id: phone + '_' + projectId,
      phone,
      projectId,
      grantedBy: currentUser.phone,
      grantedAt: Date.now(),
      canEdit: !!permEdit[phone],
      canDelete: !!permDel[phone]
    });
  }

  addSysLog('action', `更新数据权限: 项目 ${proj.name||projectId}，授权 ${phones.length} 个用户`);
  clearPermCache();

  // 关闭弹窗并刷新
  document.querySelector('.dp-modal-overlay')?.remove();
  await renderDataPerm();
  alert('权限保存成功！');
}

// ========== 权限判断工具函数 ==========
// 判断某用户是否对某项目有编辑权限
async function canUserEditProject(phone, projectId) {
  if (!phone || !projectId) return false;
  const user = await userDBGet(phone);
  if (user && user.role === 'super_admin') return true;
  const proj = await projDBGet(projectId);
  if (proj && proj.creator === phone) return true;
  const all = await permDBGetAll();
  const entry = all.find(a => a.phone === phone && a.projectId === projectId);
  return !!(entry && entry.canEdit);
}

// 判断某用户是否对某项目有删除权限
async function canUserDeleteProject(phone, projectId) {
  if (!phone || !projectId) return false;
  const user = await userDBGet(phone);
  if (user && user.role === 'super_admin') return true;
  const proj = await projDBGet(projectId);
  if (proj && proj.creator === phone) return true;
  const all = await permDBGetAll();
  const entry = all.find(a => a.phone === phone && a.projectId === projectId);
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

console.log('[DataPerm] 数据权限模块 V2 已加载');

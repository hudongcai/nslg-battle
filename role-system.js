/* ==========================================================
   ROLE SYSTEM - 角色管理、权限控制
   ========================================================== */
console.log('[role-system.js] v2026050410 加载');

// ========== 云端同步函数 ==========

// 从云端获取所有角色
async function cloudGetRoles() {
  if (!window.cloudSync) return [];
  try {
    const data = await window.cloudSync.request('/roles', { method: 'GET' });
    return data.success ? (data.data || []) : [];
  } catch (e) {
    console.error('[Cloud Role] 获取角色失败:', e);
    return [];
  }
}

// 保存角色到云端
async function cloudSaveRole(role) {
  if (!window.cloudSync) return false;
  try {
    const data = await window.cloudSync.request('/roles', {
      method: 'POST',
      body: role
    });
    return data.success === true;
  } catch (e) {
    console.error('[Cloud Role] 保存角色失败:', e);
    return false;
  }
}

// 从云端删除角色
async function cloudDeleteRole(roleId) {
  if (!window.cloudSync) return false;
  try {
    const data = await window.cloudSync.request(`/roles/${roleId}`, { method: 'DELETE' });
    return data.success === true;
  } catch (e) {
    console.error('[Cloud Role] 删除角色失败:', e);
    return false;
  }
}

// ========== 内置角色种子数据 ==========
const BUILTIN_ROLES = [
  {
    id: 'super_admin',
    name: '超级管理员',
    description: '拥有系统所有权限，可管理用户、角色和全局数据',
    isBuiltIn: true,
    permissions: {
      projectManage:true, library:true, ranking:true, peijiang:true, yanwu:true,
      systemConfig:true, userManage:true, syslog:true, dataManage:true,
      projectCreate:true, dataImport:true, winrateAnalysis:true,
      rolemanage:true, dataperm:true,
    },
  },
  {
    id: 'admin',
    name: '管理员',
    description: '可管理项目数据，无系统配置权限',
    isBuiltIn: true,
    permissions: {
      projectManage:true, library:true, ranking:true, peijiang:true, yanwu:true,
      systemConfig:false, userManage:false, syslog:false, dataManage:false,
      projectCreate:true, dataImport:true, winrateAnalysis:true,
      rolemanage:false, dataperm:false,
    },
  },
  {
    id: 'member',
    name: '普通成员',
    description: '仅可访问被分配的项目，无管理权限',
    isBuiltIn: true,
    permissions: {
      projectManage:true,  library:false, ranking:false, peijiang:false, yanwu:false,
      systemConfig:false, userManage:false, syslog:false, dataManage:false,
      projectCreate:false, dataImport:false, winrateAnalysis:false,
      rolemanage:false, dataperm:false,
    },
  },
];

// ========== 角色数据库（自定义角色）==========
const ROLE_DB_NAME = 'nslg_roles';
const ROLE_DB_VER  = 1;
const ROLE_STORE   = 'roles';
let roleDB = null;

function roleDBOpen(){
  return new Promise((resolve,reject)=>{
    if(roleDB){console.log('[roleDBOpen] 直接返回已有连接');resolve(roleDB);return;}
    console.log('[roleDBOpen] 打开数据库', ROLE_DB_NAME, '...');
    const req = indexedDB.open(ROLE_DB_NAME, ROLE_DB_VER);
    req.onupgradeneeded = e => {
      console.log('[roleDBOpen] onupgradeneeded 触发');
      const db = e.target.result;
      if(!db.objectStoreNames.contains(ROLE_STORE)){
        console.log('[roleDBOpen] 创建 store:', ROLE_STORE);
        db.createObjectStore(ROLE_STORE, {keyPath:'id'});
      }
    };
    req.onsuccess = e => { roleDB = e.target.result; console.log('[roleDBOpen] 成功'); resolve(e.target.result); };
    req.onerror   = e => { console.error('[roleDBOpen] IndexedDB 失败:', e.target.error); reject(e.target.error); };
  });
}

function roleDBGet(id){
  return new Promise((resolve,reject)=>{
    if(!roleDB){resolve(null);return;}
    const tx = roleDB.transaction(ROLE_STORE,'readonly');
    const req = tx.objectStore(ROLE_STORE).get(id);
    req.onsuccess = e => resolve(e.target.result||null);
    req.onerror   = e => reject(e.target.error);
  });
}

function roleDBGetAll(){
  return new Promise((resolve,reject)=>{
    if(!roleDB){console.warn('[roleDBGetAll] roleDB未初始化，返回[]');resolve([]);return;}
    console.log('[roleDBGetAll] 读取所有角色...');
    const tx = roleDB.transaction(ROLE_STORE,'readonly');
    const req = tx.objectStore(ROLE_STORE).getAll();
    req.onsuccess = e => { console.log('[roleDBGetAll] 读取到', (e.target.result||[]).length, '个角色'); resolve(e.target.result||[]); };
    req.onerror   = e => { console.error('[roleDBGetAll] 失败:', e.target.error); reject(e.target.error); };
  });
}

// ========== 获取角色权限 ==========
async function getRolePermissions(roleId){
  // 内置角色
  const builtin = BUILTIN_ROLES.find(r=>r.id===roleId);
  if(builtin) return builtin.permissions||{};
  // 自定义角色
  const role = await roleDBGet(roleId);
  return role? (role.permissions||{}) : null;
}

function roleDBPut(role){
  return new Promise((resolve,reject)=>{
    if(!roleDB){reject(new Error('roleDB not opened'));return;}
    const tx = roleDB.transaction(ROLE_STORE,'readwrite');
    const req = tx.objectStore(ROLE_STORE).put(role);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

function roleDBDelete(id){
  return new Promise((resolve,reject)=>{
    if(!roleDB){reject(new Error('roleDB not opened'));return;}
    const tx = roleDB.transaction(ROLE_STORE,'readwrite');
    const req = tx.objectStore(ROLE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ========== 初始化角色系统（种子内置角色）==========
// 只新增不存在的角色，不覆盖用户对已内置角色的修改
async function roleSystemInit(){
  try {
    await roleDBOpen();
    console.log('[roleSystemInit] 开始初始化角色系统...');
    
    // 优先从云端获取角色数据
    if (window.cloudSync) {
      try {
        const cloudRoles = await cloudGetRoles();
        if (cloudRoles && cloudRoles.length > 0) {
          console.log('[roleSystemInit] 从云端获取角色:', cloudRoles.length, '个');
          // 同步到本地 IndexedDB
          for (const role of cloudRoles) {
            await roleDBPut(role);
          }
          console.log('[roleSystemInit] 云端角色已同步到本地');
        }
      } catch (e) {
        console.error('[roleSystemInit] 从云端获取角色失败，使用本地数据:', e);
      }
    }
    
    // 确保内置角色存在（如果云端没有，则使用本地内置角色）
    console.log('[roleSystemInit] 种子内置角色（仅新增不存在的）...');
    let added = 0;
    for(const role of BUILTIN_ROLES){
      const exists = await roleDBGet(role.id);
      if(!exists){
        await roleDBPut(role);
        added++;
        console.log('[roleSystemInit] 新增内置角色:', role.id, role.name);
      } else {
        console.log('[roleSystemInit] 跳过已存在的角色:', role.id, '（保留用户修改）');
      }
    }
    console.log('[roleSystemInit] 种子完成，新增', added, '个角色');
    
    const all = await roleDBGetAll();
    console.log('[roleSystemInit] 验证：DB共', all.length, '个角色');
  } catch(e) {
    console.error('[roleSystemInit] 失败:', e);
  }
}

// ========== 权限定义（所有可配置的权限点）==========
// parent 为空表示顶级权限，有值表示属于某个父级权限
const PERMISSIONS = [
  // 顶级导航
  {key:'projectManage', label:'项目管理',           parent:''},
  {key:'library',       label:'武将战法库',          parent:''},
  {key:'ranking',       label:'数值排行',            parent:''},
  {key:'peijiang',      label:'配将助手',            parent:''},
  {key:'yanwu',         label:'演武助手',            parent:''},
  {key:'systemConfig',  label:'系统配置',            parent:''},
  // 系统配置子级
  {key:'userManage',    label:'用户管理',            parent:'systemConfig'},
  {key:'syslog',        label:'系统日志',            parent:'systemConfig'},
  {key:'rolemanage',    label:'角色管理',            parent:'systemConfig'},
  {key:'dataperm',      label:'数据权限',            parent:'systemConfig'},
  {key:'dataManage',    label:'数据管理',            parent:'systemConfig'},
  // 项目内子级
  {key:'projectCreate', label:'创建/编辑/删除项目',  parent:'projectManage'},
  {key:'dataImport',    label:'战报导入',             parent:'projectManage'},
  {key:'winrateAnalysis', label:'克制分析',          parent:'projectManage'},
];

// ========== 获取角色权限（含 fallback）==========
async function getRolePermissions(roleId){
  const role = await roleDBGet(roleId);
  if(role && role.permissions) return role.permissions;
  // fallback：内置角色
  const builtin = BUILTIN_ROLES.find(r=>r.id===roleId);
  return builtin ? builtin.permissions : BUILTIN_ROLES[2].permissions; // 默认 member
}

// ========== 渲染角色管理页面 ==========
async function renderRoleManage(){
  const container = document.getElementById('roleManageContent');
  if(!container){ console.warn('[renderRoleManage] container不存在'); return; }
  console.log('[renderRoleManage] 开始渲染...');
  // 从 DB 读取所有角色（内置 + 自定义）
  let allRoles = [];
  try {
    allRoles = await roleDBGetAll();
    console.log('[renderRoleManage] 从DB读取到', allRoles.length, '个角色');
  } catch(e) {
    console.warn('[renderRoleManage] 读取角色失败:', e);
  }
  // 防御：确保 roleDB 已打开
  if(!roleDB){
    console.warn('[renderRoleManage] roleDB未初始化，先 open...');
    await roleDBOpen();
    allRoles = await roleDBGetAll();
    console.log('[renderRoleManage] roleDB初始化后，读取到', allRoles.length, '个角色');
  }
  const roles = allRoles; // DB 里已包含内置角色
  console.log('[renderRoleManage] 总共', roles.length, '个角色');
  let html = '';
  html += '<div class="card" style="padding:16px 20px;margin-bottom:16px;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
  html += '<h3 style="margin:0;">角色管理</h3>';
  html += '<button class="btn btn-sm btn-primary" onclick="showRoleEdit()">＋ 新建角色</button>';
  html += '</div></div>';
  if(roles.length===0){
    html += '<div class="card" style="padding:32px;text-align:center;color:var(--text3);">暂无可用角色。</div>';
  }else{
    html += '<div class="card" style="padding:0;overflow:hidden;">';
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += '<thead><tr style="background:var(--bg2);">';
    html += '<th style="padding:10px 14px;text-align:left;">角色名称</th>';
    html += '<th style="padding:10px 14px;text-align:left;">描述</th>';
    html += '<th style="padding:10px 14px;text-align:left;">权限数</th>';
    html += '<th style="padding:10px 14px;text-align:left;">操作</th>';
    html += '</tr></thead><tbody>';
    for(const r of roles){
      const permCount = r.permissions ? Object.values(r.permissions).filter(Boolean).length : 0;
      html += '<tr style="border-top:1px solid var(--border);">';
      html += `<td style="padding:10px 14px;font-weight:600;">${escHtml(r.name)}${r.isBuiltIn?' <span style="font-size:12px;color:var(--text3);">(内置)</span>':''}</td>`;
      html += `<td style="padding:10px 14px;color:var(--text2);">${escHtml(r.description||'-')}</td>`;
      html += `<td style="padding:10px 14px;">${permCount} / ${PERMISSIONS.length}</td>`;
      html += '<td style="padding:10px 14px;">';
      html += `<button class="btn btn-sm btn-secondary" style="margin-right:6px;" onclick="showRoleEdit('${r.id}')">编辑</button>`;
      if(!r.isBuiltIn){
        html += `<button class="btn btn-sm btn-danger" onclick="deleteRole('${r.id}')">删除</button>`;
      }
      html += '</td></tr>';
    }
    html += '</tbody></table></div>';
  }
  container.innerHTML = html;
}

// ========== 显示角色编辑弹窗（新建/编辑）==========
// 权限层级：顶级 → 子级
// 勾选子级时自动勾选父级；取消父级时自动取消所有子级
async function showRoleEdit(roleId){
  const isEdit = !!roleId;
  let role = {id:'', name:'', description:'', permissions:{}, isBuiltIn:false};
  if(isEdit){
    const r = await roleDBGet(roleId);
    if(!r){alert('角色不存在');return;}
    role = r;
  }

  // 按 parent 分组
  const topPerms = PERMISSIONS.filter(p=>!p.parent); // 顶级权限
  const childMap = {}; // parentKey → [子权限列表]
  for(const p of PERMISSIONS){
    if(p.parent){
      if(!childMap[p.parent]) childMap[p.parent] = [];
      childMap[p.parent].push(p);
    }
  }

  // 生成单个复选框 HTML（带 onChange）
  function permCheckboxes(perms, indent){
    let html = '';
    for(const p of perms){
      const checked = role.permissions&&role.permissions[p.key]?'checked':'';
      const pad = indent ? 'style="padding-left:20px;"' : '';
      html += `<label ${pad} style="display:flex;align-items:center;margin-bottom:6px;cursor:pointer;min-width:200px;">
        <input type="checkbox" id="perm_${p.key}" ${checked}
          onchange="permOnChange('${p.key}','${p.parent}',this.checked)"
          style="margin-right:8px;width:15px;height:15px;cursor:pointer;">
        ${p.label}
      </label>`;
    }
    return html;
  }

  // 构建分组 HTML
  let permHtml = '';
  for(const p of topPerms){
    const children = childMap[p.key]||[];
    const checked = role.permissions&&role.permissions[p.key]?'checked':'';
    permHtml += `
      <div style="margin-bottom:14px;padding:10px 14px;background:var(--bg2);border-radius:8px;border:1px solid var(--border);">
        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;margin-bottom:${children.length?'10px':'0'};">
          <input type="checkbox" id="perm_${p.key}" ${checked}
            onchange="permOnChange('${p.key}','',this.checked)"
            style="margin-right:8px;width:15px;height:15px;cursor:pointer;">
          ${p.label}
          <span style="font-size:12px;color:var(--text3);font-weight:400;margin-left:6px;">（顶级导航）</span>
        </label>
        ${children.length ? permCheckboxes(children, true) : ''}
      </div>`;
  }
  // 无父级的子权限（兜底，应该为空）
  const orphans = PERMISSIONS.filter(p=>p.parent&&!childMap[p.parent]);
  if(orphans.length){
    permHtml += `<div style="color:var(--text3);font-size:12px;margin-bottom:8px;">其他权限：</div>`;
    permHtml += permCheckboxes(orphans, false);
  }

  const html = `
    <div id="roleEditMask" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div style="background:var(--card);border-radius:12px;padding:28px 32px;min-width:560px;max-width:680px;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
        <h3 style="margin:0 0 18px 0;">${isEdit?'编辑角色':'新建角色'}</h3>
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:4px;font-weight:600;">角色名称</label>
          <input id="roleName" value="${escHtml(role.name)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);box-sizing:border-box;" ${isEdit&&role.isBuiltIn?'readonly':''}>
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:4px;font-weight:600;">描述</label>
          <input id="roleDesc" value="${escHtml(role.description||'')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);box-sizing:border-box;">
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:8px;font-weight:600;">权限设置 <span style="font-size:12px;color:var(--text3);font-weight:400;">（勾选子权限将自动勾选父级）</span></label>
          <div>${permHtml}</div>
        </div>
        <div style="text-align:right;">
          <button class="btn btn-secondary" style="margin-right:8px;" onclick="closeRoleEdit()">取消</button>
          <button class="btn btn-primary" onclick="saveRole('${roleId||''}')">保存</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

// ========== 权限勾选联动逻辑 ==========
// key: 被操作的权限 key
// parentKey: 父级 key（顶级权限的 parent 为空字符串）
// checked: 当前状态
function permOnChange(key, parentKey, checked){
  if(checked && parentKey){
    // 子权限被勾选 → 强制勾选父级
    const parentCb = document.getElementById('perm_'+parentKey);
    if(parentCb && !parentCb.checked) parentCb.checked = true;
  }
  if(!checked && !parentKey){
    // 顶级权限被取消 → 取消所有子权限
    const children = PERMISSIONS.filter(p=>p.parent===key);
    for(const c of children){
      const cb = document.getElementById('perm_'+c.key);
      if(cb) cb.checked = false;
    }
  }
}

function closeRoleEdit(){
  const mask = document.getElementById('roleEditMask');
  if(mask) mask.remove();
}

// ========== 保存角色 ==========
async function saveRole(roleId){
  const isEdit = !!roleId;
  const name = document.getElementById('roleName').value.trim();
  const desc = document.getElementById('roleDesc').value.trim();
  if(!name){alert('请输入角色名称');return;}
  // 收集权限
  const permissions = {};
  for(const p of PERMISSIONS){
    permissions[p.key] = document.getElementById('perm_'+p.key).checked;
  }
  let id = roleId;
  if(!isEdit){
    id = 'role_' + Date.now();
  }
  const existingRole = isEdit ? await roleDBGet(id) : null;
  const role = {
    id, name, description:desc, permissions,
    isBuiltIn: existingRole ? !!existingRole.isBuiltIn : false,
  };
  try{
    // 先保存到云端
    if (window.cloudSync) {
      const cloudResult = await cloudSaveRole(role);
      if (!cloudResult) {
        console.warn('[saveRole] 云端保存失败，仅保存到本地');
      }
    }
    // 再保存到本地
    await roleDBPut(role);
    addSysLog('operation', (isEdit?'编辑':'新建')+'角色: '+name);
    closeRoleEdit();
    await renderRoleManage();
  }catch(e){alert('保存失败：'+e.message);}
}

// ========== 删除角色 ==========
async function deleteRole(roleId){
  const role = await roleDBGet(roleId);
  if(!role) return;
  if(role.isBuiltIn){alert('内置角色不可删除');return;}
  if(!confirm('确定删除角色「'+role.name+'」？已分配该角色的用户将变为"普通成员"。'))return;
  try{
    // 先从云端删除
    if (window.cloudSync) {
      const cloudResult = await cloudDeleteRole(roleId);
      if (!cloudResult) {
        console.warn('[deleteRole] 云端删除失败，仅从本地删除');
      }
    }
    // 将该角色的用户改为 member
    const users = await userDBGetAll();
    for(const u of users){
      if(u.role===roleId){
        u.role = 'member';
        await userDBPut(u);
      }
    }
    await roleDBDelete(roleId);
    addSysLog('delete','删除角色: '+role.name);
    await renderRoleManage();
  }catch(e){alert('删除失败：'+e.message);}
}

// ========== 更新导航（按角色权限）==========
async function updateNavByRole(){
  if(!currentUser){
    document.querySelectorAll('#topNav button').forEach(b=>b.style.display='none');
    document.getElementById('systemSubNav').style.display='none';
    // 隐藏积分商城按钮
    const mallBtn = document.getElementById('pointsMallBtn');
    if(mallBtn) mallBtn.style.display='none';
    return;
  }
  const perms = await getRolePermissions(currentUser.role);
  // 顶级导航按钮
  const btnMap = {
    'navProjectBtn':  'projectManage',
    'navLibraryBtn':  'library',
    'navRankingBtn':  'ranking',
    'navPeijiangBtn': 'peijiang',
    'navYanwuBtn':    'yanwu',
    'navSystemBtn':   'systemConfig',
  };
  for(const [btnId, permKey] of Object.entries(btnMap)){
    const btn = document.getElementById(btnId);
    if(btn) btn.style.display = perms[permKey] ? 'inline-block' : 'none';
  }
  // 系统配置子导航
  const subMap = {
    'subUserManage': 'userManage',
    'subSysLog':     'syslog',
    'subDataManage': 'dataManage',
    'subRoleManage': 'rolemanage',
    'subDataPerm':   'dataperm',
  };
  for(const [btnId, permKey] of Object.entries(subMap)){
    const btn = document.getElementById(btnId);
    if(btn) btn.style.display = perms[permKey] ? 'inline-block' : 'none';
  }
  // 云端服务按钮：仅超管可见（不受权限系统控制）
  const cloudBtn = document.getElementById('subCloudService');
  if(cloudBtn) cloudBtn.style.display = (currentUser?.role==='super_admin') ? 'inline-block' : 'none';
  // 如果系统配置不可见，隐藏 subNav
  if(!perms['systemConfig']){
    document.getElementById('systemSubNav').style.display='none';
  }
  // 积分商城：所有登录用户可见
  const mallBtn = document.getElementById('pointsMallBtn');
  if(mallBtn) mallBtn.style.display='inline-block';
}

// ========== 检查项目操作权限 ==========
async function hasProjectPermission(permKey){
  if(!currentUser) return false;
  const perms = await getRolePermissions(currentUser.role);
  return !!perms[permKey];
}

// ========== escHtml 防御（如果全局没有则定义）==========
if(typeof escHtml==='undefined'){
  function escHtml(s){
    if(!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

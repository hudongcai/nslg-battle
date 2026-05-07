/* ==========================================================
  ROLE SYSTEM - 角色管理、权限控制
  双层权限：菜单权限（角色） + 数据权限（项目归属）
  版本: v2026050713
  ========================================================== */
console.log('[role-system.js] v2026050412 加载');

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
// ⚑3 projCreate：创建项目权限（内置到角色模板，非写死）
// ⚑2 projVisibilityToggle：可见性开关（私有项目细粒度可分配权限）
// ⚑1 projDelete：公共项目禁止任何删除（超管可绕过），在 canDoAction 中强制校验
const BUILTIN_ROLES = [
  {
    id: 'super_admin',
    name: '超级管理员',
    description: '拥有系统所有权限，可管理用户、角色和全局数据',
    isBuiltIn: true,
    permissions: {
      // 顶级导航
      projectManage:true, library:true, ranking:true, peijiang:true, yanwu:true, systemConfig:true,
      // 系统配置子级
      rolemanage:true, userManage:true, dataperm:true, dataManage:true, cloudService:true, syslog:true,
      // 项目管理子级
      projCreate:true, projEdit:true, projDelete:true, projMember:true, projVisibilityToggle:true,
      dataImport:true, dataBatchSelect:true, dataRecordDelete:true, dataTableDelete:true, dataExport:true,
      winrateAnalysis:true,
    },
  },
  {
    id: 'admin',
    name: '管理员',
    description: '可管理项目数据，无系统配置权限',
    isBuiltIn: true,
    permissions: {
      projectManage:true, library:true, ranking:true, peijiang:true, yanwu:true, systemConfig:false,
      rolemanage:false, userManage:false, dataperm:false, dataManage:false, cloudService:false, syslog:false,
      projCreate:true, projEdit:true, projDelete:false, projMember:true, projVisibilityToggle:false,
      dataImport:true, dataBatchSelect:true, dataRecordDelete:true, dataTableDelete:true, dataExport:true,
      winrateAnalysis:true,
    },
  },
  {
    id: 'member',
    name: '普通成员',
    description: '仅可访问被分配的项目，无管理权限',
    isBuiltIn: true,
    permissions: {
      projectManage:true, library:false, ranking:false, peijiang:false, yanwu:false, systemConfig:false,
      rolemanage:false, userManage:false, dataperm:false, dataManage:false, cloudService:false, syslog:false,
      projCreate:false, projEdit:false, projDelete:false, projMember:false, projVisibilityToggle:false,
      dataImport:false, dataBatchSelect:false, dataRecordDelete:false, dataTableDelete:false, dataExport:false,
      winrateAnalysis:false,
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
  // 先查 IndexedDB（数据库同步后的最新值）
  const role = await roleDBGet(roleId);
  if(role) return migratePermissions(role.permissions||{});
  // 没有才用内置角色兜底
  const builtin = BUILTIN_ROLES.find(r=>r.id===roleId);
  if(builtin) return builtin.permissions||{};
  return null;
}

// ========== 权限迁移：旧格式 → 新格式 ==========
function migratePermissions(perms) {
  const result = { ...perms };
  // projectCreate → projCreate + projEdit + projDelete
  if (result.projectCreate) {
    result.projCreate = true;
    result.projEdit = true;
    result.projDelete = true;
  }
  // 确保所有新权限字段存在（默认为 false）
  const allKeys = PERMISSIONS.map(p => p.key);
  for (const key of allKeys) {
    if (result[key] === undefined) result[key] = false;
  }
  return result;
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

    // 确保内置角色存在（只新增本地不存在的，绝不覆盖已有角色）
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

    // 云端同步：角色权限以数据库为真相之源，每次启动都强制从云端拉取最新
    if (window.cloudSync) {
      try {
        const cloudRoles = await cloudGetRoles();
        if (cloudRoles && cloudRoles.length > 0) {
          console.log('[roleSystemInit] 从云端同步', cloudRoles.length, '个角色（覆盖本地缓存）');
          for (const role of cloudRoles) {
            await roleDBPut(role); // 直接覆盖，保证最新
          }
        }
      } catch (e) {
        console.error('[roleSystemInit] 云端同步失败，使用本地数据:', e);
      }
    }

    const all = await roleDBGetAll();
    console.log('[roleSystemInit] 验证：DB共', all.length, '个角色');
  } catch(e) {
    console.error('[roleSystemInit] 失败:', e);
  }
}

// ========== 权限定义（所有可配置的权限点）==========
// ⚑2 visibility_toggle → projVisibilityToggle（可见性开关，加入私有项目细粒度可分配权限）
// ⚑3 projectCreate → projCreate（创建项目，内置角色权限）
// parent 为空表示顶级导航权限，有值表示属于某个父级权限的子权限
const PERMISSIONS = [
  // ========== 顶级导航 ==========
  {key:'projectManage', label:'项目管理',           parent:''},
  {key:'library',       label:'武将战法库',          parent:''},
  {key:'ranking',       label:'数值排行',            parent:''},
  {key:'peijiang',      label:'配将助手',            parent:''},
  {key:'yanwu',         label:'演武助手',            parent:''},
  {key:'systemConfig',  label:'系统配置',            parent:''},

  // ========== 系统配置子级 ==========
  {key:'rolemanage',    label:'角色管理',            parent:'systemConfig'},
  {key:'userManage',    label:'用户管理',            parent:'systemConfig'},
  {key:'dataperm',      label:'数据权限',            parent:'systemConfig'},
  {key:'dataManage',    label:'数据管理',            parent:'systemConfig'},
  {key:'cloudService',  label:'云端服务',            parent:'systemConfig'},
  {key:'syslog',        label:'系统日志',            parent:'systemConfig'},

  // ========== 项目管理子级（项目内操作）==========
  {key:'projCreate',         label:'创建项目',              parent:'projectManage'},   // ⚑3
  {key:'projEdit',           label:'编辑项目',              parent:'projectManage'},
  {key:'projDelete',         label:'删除项目',              parent:'projectManage'},   // ⚑1 公共项目禁止
  {key:'projMember',         label:'成员管理',              parent:'projectManage'},
  {key:'projVisibilityToggle',label:'可见性开关',           parent:'projectManage'},   // ⚑2
  {key:'dataImport',         label:'战报导入',              parent:'projectManage'},
  {key:'dataBatchSelect',    label:'战报库批量选择',        parent:'projectManage'},
  {key:'dataRecordDelete',   label:'战报删除',              parent:'projectManage'},
  {key:'dataTableDelete',    label:'数据底表删除',          parent:'projectManage'},
  {key:'dataExport',         label:'数据底表导出',           parent:'projectManage'},
  {key:'winrateAnalysis',    label:'克制分析导出',          parent:'projectManage'},
];

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
  if(checked && !parentKey){
    // 顶级权限被勾选 → 自动勾选所有子权限
    const children = PERMISSIONS.filter(p=>p.parent===key);
    for(const c of children){
      const cb = document.getElementById('perm_'+c.key);
      if(cb && !cb.checked) cb.checked = true;
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
    let cloudOK = true;
    if (window.cloudSync) {
      cloudOK = await cloudSaveRole(role);
      if (!cloudOK) {
        console.warn('[saveRole] 云端保存失败，仅保存到本地');
      }
    }
    // 再保存到本地
    await roleDBPut(role);
    addSysLog('operation', (isEdit?'编辑':'新建')+'角色: '+name);
    closeRoleEdit();
    await renderRoleManage();
    // 明确告知用户云端同步状态
    if (!cloudOK) {
      alert('角色已保存到本地，但云端同步失败！\n下次刷新前请检查网络连接，或手动重新保存。');
    }
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
    'subRoleManage': 'rolemanage',
    'subUserManage': 'userManage',
    'subDataPerm':   'dataperm',
    'subDataManage': 'dataManage',
    'subCloudService': 'cloudService',
    'subSysLog':     'syslog',
  };
  for(const [btnId, permKey] of Object.entries(subMap)){
    const btn = document.getElementById(btnId);
    if(btn) btn.style.display = perms[permKey] ? 'inline-block' : 'none';
  }
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

// ==========================================================
// 双层权限核心函数
// 层级：P1 超管 > P2 创建者私有权限 > P3 角色菜单权限 > P4 公共项目兜底只读
// ==========================================================

// ---------- hasPermission ----------
// P1+P3：纯角色菜单权限（不含数据归属校验，供 UI 显隐用）
// ⚑3：projCreate → 角色菜单权限，创建项目时调用
async function hasPermission(permKey) {
  if (!currentUser) return false;
  // P1：超管 bypass
  if (currentUser.role === 'super_admin') return true;
  const perms = await getRolePermissions(currentUser.role);
  return !!perms[permKey];
}

// ---------- filterVisibleProjects ----------
// P2+P4：数据层可见性过滤（项目列表 → 只返回有权限看到的项目）
// 返回 filteredProjects（不在项目内的成员/公开项目创建者可见）
async function filterVisibleProjects(projects) {
  if (!currentUser) return [];
  // P1：超管看全部
  if (currentUser.role === 'super_admin') return projects;

  // 云端优先：先同步最新项目归属
  if (window.cloudSync) {
    try {
      await window.cloudSync.syncToLocal ? window.cloudSync.syncToLocal() : Promise.resolve();
    } catch(e) {}
  }

  // P2：创建者 + P4：公开项目
  const visible = projects.filter(p => {
    // 创建者
    if (p.creator === currentUser.id) return true;
    // 公开项目
    if (p.visibility === 'public') return true;
    // 项目成员（需要查 project_members 或 projAccess）
    return false;
  });

  // 补充成员可见性（查本地 projAccess + cloud）
  if (window.cloudSync) {
    try {
      const myAccess = await (window.cloudSync.getMyAccess ? window.cloudSync.getMyAccess() : Promise.resolve([]));
      const accessProjIds = new Set(myAccess.map(a => a.projectId));
      for (const p of projects) {
        if (accessProjIds.has(String(p.id)) || accessProjIds.has(Number(p.id))) {
          if (!visible.find(v => v.id === p.id)) visible.push(p);
        }
      }
    } catch(e) {}
  }

  return visible;
}

// ---------- canDoAction ----------
// 完整 P1-P4 权限判断（含 ⚑1 公共项目操作禁止）
// actionKey: 'projEdit' | 'projDelete' | 'projMember' | 'projVisibilityToggle' |
//            'dataImport' | 'dataBatchSelect' | 'dataRecordDelete' | 'dataTableDelete' | 'dataExport' | 'winrateAnalysis'
// project: 当前项目对象（必须含 id, creator, visibility 字段）
// 返回: true = 允许，false = 拒绝
async function canDoAction(actionKey, project) {
  if (!currentUser) return false;

  // P1：超管 bypass ⚑1 之外的所有校验
  if (currentUser.role === 'super_admin') {
    // ⚑1 唯一限制：超管也不能删公共项目（除非未来需求变更）
    // if (actionKey === 'projDelete' && project?.visibility === 'public') return false;
    // 当前规则：超管可删一切，这里保持宽松
    return true;
  }

  // 基础校验：用户必须在该项目内有身份（创建者 / 公开 / 成员）
  const isCreator = project && project.creator === currentUser.id;
  const isPublic  = project && project.visibility === 'public';
  const isMember  = false; // TODO: 后续接 project_members / projAccess 后补充

  if (!isCreator && !isPublic && !isMember) return false;

  // ⚑1 公共项目操作禁止：projDelete
  if (actionKey === 'projDelete' && isPublic) return false;

  // P2：创建者私有权限（强制拥有，与角色无关）
  const creatorForcedKeys = ['projEdit', 'projMember', 'projVisibilityToggle',
                             'dataImport', 'dataBatchSelect', 'dataRecordDelete',
                             'dataTableDelete', 'dataExport', 'winrateAnalysis'];
  if (isCreator && creatorForcedKeys.includes(actionKey)) return true;

  // P3：角色菜单权限
  const perms = await getRolePermissions(currentUser.role);
  return !!perms[actionKey];
}

// ========== escHtml 防御（如果全局没有则定义）==========
if(typeof escHtml==='undefined'){
  function escHtml(s){
    if(!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

/* ==========================================================
   ROLE SYSTEM - 角色管理、权限控制
   ========================================================== */
console.log('[role-system.js] v202605022110 加载');

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
      rolemanage:true, dataperm:true,
      projectCreate:true, dataImport:true, winrateAnalysis:true,
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
      rolemanage:false, dataperm:false,
      projectCreate:true, dataImport:true, winrateAnalysis:true,
    },
  },
  {
    id: 'member',
    name: '普通成员',
    description: '可使用战报导入和克制分析功能',
    isBuiltIn: true,
    permissions: {
      projectManage:true, library:true, ranking:true, peijiang:true, yanwu:true,
      systemConfig:false, userManage:false, syslog:false, dataManage:false,
      rolemanage:false, dataperm:false,
      projectCreate:false, dataImport:true, winrateAnalysis:true,
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
// 只在角色不存在时才写入，保留用户在「角色管理」里的修改
// 但对已存在的内置角色，会自动补充 BUILTIN_ROLES 里新增的权限 key
async function roleSystemInit(){
  try {
    await roleDBOpen();
    console.log('[roleSystemInit] 检查内置角色...');
    let created = 0, updated = 0;
    for(const role of BUILTIN_ROLES){
      const existing = await roleDBGet(role.id);
      if(!existing){
        await roleDBPut(role);
        created++;
        console.log('[roleSystemInit] 新建内置角色:', role.id);
      } else {
        // 补充缺失的权限 key（保留用户已有的自定义权限）
        let changed = false;
        const mergedPerms = { ...existing.permissions };
        for (const [k, v] of Object.entries(role.permissions)) {
          if (!(k in mergedPerms)) {
            mergedPerms[k] = v; // 新增的权限 key，使用 BUILTIN 默认值
            changed = true;
          }
        }
        if (changed) {
          existing.permissions = mergedPerms;
          await roleDBPut(existing);
          updated++;
          console.log('[roleSystemInit] 补充权限 key 到:', role.id, mergedPerms);
        } else {
          console.log('[roleSystemInit] 内置角色已存在，无需更新:', role.id);
        }
      }
    }
    if(created > 0) console.log('[roleSystemInit] 新建', created, '个内置角色');
    if(updated > 0) console.log('[roleSystemInit] 更新', updated, '个内置角色（补充新权限）');
    if(created === 0 && updated === 0) console.log('[roleSystemInit] 所有内置角色已是最新，无需操作');
    const all = await roleDBGetAll();
    console.log('[roleSystemInit] 验证：DB共', all.length, '个角色');
  } catch(e) {
    console.error('[roleSystemInit] 失败:', e);
  }
}

// ========== 权限定义（所有可配置的权限点）==========
const PERMISSIONS = [
  {key:'projectManage',  label:'项目管理（顶级导航可见）'},
  {key:'library',       label:'武将战法库（顶级导航可见）'},
  {key:'ranking',       label:'数值排行（顶级导航可见）'},
  {key:'peijiang',      label:'配将助手（顶级导航可见）'},
  {key:'yanwu',         label:'演武助手（顶级导航可见）'},
  {key:'systemConfig',  label:'系统配置（顶级导航可见）'},
  {key:'userManage',    label:'用户管理（系统配置子菜单）'},
  {key:'syslog',        label:'系统日志（系统配置子菜单）'},
  {key:'dataManage',    label:'数据管理（系统配置子菜单）'},
  {key:'rolemanage',    label:'角色管理（系统配置子菜单）'},
  {key:'dataperm',      label:'数据权限（系统配置子菜单）'},
  {key:'projectCreate', label:'创建/编辑/删除项目'},
  {key:'dataImport',    label:'战报导入（项目内可用）'},
  {key:'winrateAnalysis', label:'克制分析（项目内可用）'},
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
  // 防御：确保 roleDB 已打开，或 allRoles 为空时重试
  if(!roleDB || allRoles.length === 0){
    if(!roleDB){
      console.warn('[renderRoleManage] roleDB未初始化，先 open...');
    } else {
      console.warn('[renderRoleManage] allRoles为空，重试读取...');
    }
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
  console.log('[renderRoleManage v202605022120] HTML已写入，innerHTML长度:', container.innerHTML.length);
  // 强制显示整个父级链
  const tab = document.getElementById('tab-rolemanage');
  if (!tab) { console.error('[renderRoleManage] tab-rolemanage 未找到!'); return; }
  let p = tab.parentElement;
  while (p) {
    const cs = getComputedStyle(p);
    if (cs.display === 'none') {
      p.style.display = 'block';
      console.warn('[renderRoleManage] 强制显示父级:', p.tagName, p.id ? '#'+p.id : p.className, 'display:none');
    }
    if (p.id === 'mainApp') break;
    p = p.parentElement;
  }
  tab.style.display = 'block';
  tab.classList.add('active');
  container.style.display = 'block';
  // 强制回流
  void tab.offsetHeight;
  // 打印 container 的关键 computed style
  const ccs = getComputedStyle(container);
  console.log('[renderRoleManage] container computed:', 'display:', ccs.display, 'height:', ccs.height, 'minHeight:', ccs.minHeight, 'overflow:', ccs.overflow, 'visibility:', ccs.visibility, 'opacity:', ccs.opacity);
  console.log('[renderRoleManage] 强制后:', 'tab.offsetHeight:', tab.offsetHeight, 'container.offsetHeight:', container.offsetHeight, 'container.scrollHeight:', container.scrollHeight);
  // rAF 后再确认
  requestAnimationFrame(()=>{
    console.log('[renderRoleManage] RAF:', 'tab.offsetHeight:', tab.offsetHeight, 'container.offsetHeight:', container.offsetHeight, 'offsetParent:', tab.offsetParent ? tab.offsetParent.tagName+(tab.offsetParent.id?'#'+tab.offsetParent.id:'') : 'null');
  });
}

// ========== 显示角色编辑弹窗（新建/编辑）==========
async function showRoleEdit(roleId){
  const isEdit = !!roleId;
  let role = {id:'', name:'', description:'', permissions:{}, isBuiltIn:false};
  if(isEdit){
    const r = await roleDBGet(roleId);
    if(!r){alert('角色不存在');return;}
    role = r;
  }
  // 构建权限复选框
  let permHtml = '';
  for(const p of PERMISSIONS){
    const checked = role.permissions&&role.permissions[p.key]?'checked':'';
    permHtml += `<label style="display:inline-block;margin-right:16px;margin-bottom:8px;min-width:200px;">
      <input type="checkbox" id="perm_${p.key}" ${checked}> ${p.label}
    </label>`;
  }
  const html = `
    <div id="roleEditMask" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div style="background:var(--card);border-radius:12px;padding:28px 32px;min-width:520px;max-width:640px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
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
          <label style="display:block;margin-bottom:6px;font-weight:600;">权限设置</label>
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
    'subUserManage':  'userManage',
    'subSysLog':      'syslog',
    'subDataManage':  'dataManage',
    'subRoleManage':  'rolemanage',
    'subDataPerm':    'dataperm',
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
  // 积分商城：所有登录用户可见（补充 user-system.js 的逻辑）
  const mallBtn = document.getElementById('pointsMallBtn');
  if(mallBtn) mallBtn.style.display = 'inline-block';
  // 更新右上角积分数显示
  if(typeof updateUserNavPoints === 'function') updateUserNavPoints();
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

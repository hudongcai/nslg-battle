/* ==========================================================
   USER SYSTEM - 用户登录、注册、用户管理
   ========================================================== */

// 兼容：如果 role-system.js 未加载，提供 getRolePermissions 兜底实现
if(typeof getRolePermissions==='undefined'){
  window.getRolePermissions = async function(roleId){
    const BUILTIN = [
      {id:'super_admin', name:'超级管理员', permissions:{'projectManage':true,'library':true,'ranking':true,'peijiang':true,'yanwu':true,'systemConfig':true,'userManage':true,'syslog':true,'dataManage':true,'projectCreate':true,'dataImport':true,'winrateAnalysis':true}},
      {id:'admin',        name:'管理员',        permissions:{'projectManage':true,'library':true,'ranking':true,'peijiang':true,'yanwu':true,'systemConfig':false,'userManage':false,'syslog':false,'dataManage':false,'projectCreate':true,'dataImport':true,'winrateAnalysis':true}},
      {id:'member',       name:'普通成员',      permissions:{'projectManage':true,'library':true,'ranking':true,'peijiang':true,'yanwu':true,'systemConfig':false,'userManage':false,'syslog':false,'dataManage':false,'projectCreate':false,'dataImport':true,'winrateAnalysis':true}},
    ];
    const r = BUILTIN.find(x=>x.id===roleId);
    return r ? r.permissions : BUILTIN[2].permissions;
  };
  console.warn('[user-system] getRolePermissions 兜底定义已生效');
}

// ========== 超级管理员默认账号 ==========
const SUPER_ADMIN_PHONE = '13651810449';
const SUPER_ADMIN_PWD   = 'hu6956521';

// ========== 全局状态 ==========
let currentUser = null;   // 当前登录用户 {phone, name, role}

// ========== DB：users / projects / roles / projAccess / proj_members 存储 ==========
function openUserDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open('SanMoUserDB',5); // v5 (V1.0): 新增 proj_members Store
    req.onupgradeneeded = e=>{
      const db = e.target.result;
      const oldV = e.oldVersion;
      if(oldV < 1){
        if(!db.objectStoreNames.contains('users')){
          db.createObjectStore('users',{keyPath:'phone'});
        }
        if(!db.objectStoreNames.contains('projects')){
          const ps = db.createObjectStore('projects',{keyPath:'id'});
          ps.createIndex('creator','creator',{unique:false});
        }
      }
      if(oldV < 2){
        if(!db.objectStoreNames.contains('roles')){
          db.createObjectStore('roles',{keyPath:'id'});
        }
      }
      if(oldV < 3){
        if(!db.objectStoreNames.contains('projAccess')){
          const pas = db.createObjectStore('projAccess',{keyPath:'id'});
          pas.createIndex('phone','phone',{unique:false});
          pas.createIndex('projectId','projectId',{unique:false});
        }
      }
      if(oldV < 4){
        // v4: 为所有已有用户补充 points 字段（默认 18）
        if(db.objectStoreNames.contains('users')){
          const tx = e.target.transaction;
          const store = tx.objectStore('users');
          const getReq = store.getAll();
          getReq.onsuccess = ()=>{
            const users = getReq.result||[];
            users.forEach(u=>{
              if(typeof u.points !== 'number' || u.points < 18){
                u.points = 18;
                store.put(u);
              }
            });
            console.log('[UserDB v4] 已为', users.length, '个用户补充 points 字段（默认值18）');
          };
        }
      }
      if(oldV < 5){
        // v5 (V1.0): 新增 proj_members Store
        if(!db.objectStoreNames.contains('proj_members')){
          const pms = db.createObjectStore('proj_members',{keyPath:'id',autoIncrement:true});
          pms.createIndex('phone','phone',{unique:false});
          pms.createIndex('projectId','projectId',{unique:false});
        }
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror   = ()=>reject(req.error);
  });
}

// ========== V1.0 新增：proj_members 表操作 ==========
function projMemberDBAdd(rec){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['proj_members'],'readwrite');
      const req = tx.objectStore('proj_members').add(rec);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}
function projMemberDBPut(rec){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['proj_members'],'readwrite');
      const req = tx.objectStore('proj_members').put(rec);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}
function projMemberDBGetAll(){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      if(!db.objectStoreNames.contains('proj_members')){resolve([]);return;}
      const tx = db.transaction(['proj_members'],'readonly');
      const req = tx.objectStore('proj_members').getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror   = ()=>resolve([]);
    }).catch(()=>resolve([]));
  });
}
function projMemberDBDelete(id){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['proj_members'],'readwrite');
      const req = tx.objectStore('proj_members').delete(id);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

// ========== 角色 DB 操作 ==========
function roleDBGetAll(){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      if(!db.objectStoreNames.contains('roles')){resolve([]);return;}
      const tx = db.transaction(['roles'],'readonly');
      const req = tx.objectStore('roles').getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror   = ()=>resolve([]);
    }).catch(()=>resolve([]));
  });
}
function roleDBGet(id){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      if(!db.objectStoreNames.contains('roles')){resolve(null);return;}
      const tx = db.transaction(['roles'],'readonly');
      const req = tx.objectStore('roles').get(id);
      req.onsuccess = ()=>resolve(req.result||null);
      req.onerror   = ()=>resolve(null);
    }).catch(()=>resolve(null));
  });
}
function roleDBPut(role){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['roles'],'readwrite');
      const req = tx.objectStore('roles').put(role);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}
function roleDBDelete(id){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['roles'],'readwrite');
      const req = tx.objectStore('roles').delete(id);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

// ========== 确保用户有 role 字段（迁移）==========
async function migrateUserRoles(){
  try{
    const users = await userDBGetAll();
    for(const u of users){
      if(!u.role){
        u.role = u.phone===SUPER_ADMIN_PHONE ? 'super_admin' : 'admin';
        await userDBPut(u);
      }
    }
  }catch(e){console.error('migrateUserRoles failed:',e);}
}

// ========== 项目 DB 操作 ==========
function projDBGetAll(){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['users'],'readonly');
      const req = tx.objectStore('users').getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

function userDBDelete(phone){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['users'],'readwrite');
      const req = tx.objectStore('users').delete(phone);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

// ========== 积分管理 ==========
function userDBGet(phone){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['users'],'readonly');
      const req = tx.objectStore('users').get(phone);
      req.onsuccess = ()=>resolve(req.result||null);
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

function userDBPut(user){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['users'],'readwrite');
      const req = tx.objectStore('users').put(user);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

function userDBGetAll(){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx  = db.transaction(['users'],'readonly');
      const req = tx.objectStore('users').getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}

// 获取用户积分
function getUserPoints(phone){
  return userDBGet(phone).then(u=> u ? (u.points || 0) : 0);
}

// 增加用户积分（充值时调用）
function addUserPoints(phone, amount){
  return userDBGet(phone).then(u=>{
    if(!u) throw new Error('用户不存在: '+phone);
    u.points = (u.points || 0) + amount;
    if(currentUser && currentUser.phone === phone){
      currentUser.points = u.points;
      saveSession(currentUser);
    }
    return userDBPut(u).then(()=>u.points);
  });
}

// 扣减用户积分（OCR 上传时调用），返回是否成功
function deductUserPoints(phone, amount){
  return userDBGet(phone).then(u=>{
    if(!u) throw new Error('用户不存在: '+phone);
    if((u.points || 0) < amount) return false; // 积分不足
    u.points = u.points - amount;
    if(currentUser && currentUser.phone === phone){
      currentUser.points = u.points;
      saveSession(currentUser);
    }
    return userDBPut(u).then(()=>true);
  });
}

// ========== 项目 DB 操作 ==========
function projDBGetAll(){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      if(!db.objectStoreNames.contains('projects')){resolve([]);return;}
      const tx = db.transaction(['projects'],'readonly');
      const req = tx.objectStore('projects').getAll();
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror   = ()=>resolve([]);
    }).catch(()=>resolve([]));
  });
}
function projDBPut(proj){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['projects'],'readwrite');
      const req = tx.objectStore('projects').put(proj);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}
function projDBDelete(id){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      const tx = db.transaction(['projects'],'readwrite');
      const req = tx.objectStore('projects').delete(id);
      req.onsuccess = ()=>resolve();
      req.onerror   = ()=>reject(req.error);
    }).catch(reject);
  });
}
function projDBGet(id){
  return new Promise((resolve,reject)=>{
    openUserDB().then(db=>{
      if(!db.objectStoreNames.contains('projects')){resolve(null);return;}
      const tx = db.transaction(['projects'],'readonly');
      const req = tx.objectStore('projects').get(id);
      req.onsuccess = ()=>resolve(req.result||null);
      req.onerror   = ()=>resolve(null);
    }).catch(()=>resolve(null));
  });
}

// ========== 初始化超级管理员 ==========
async function ensureSuperAdmin(){
  try{
    let admin = await userDBGet(SUPER_ADMIN_PHONE);
    if(!admin){
      admin = {
        phone: SUPER_ADMIN_PHONE,
        name: '超级管理员',
        password: SUPER_ADMIN_PWD,
        role: 'super_admin',
        avatar: '',
        points: 18,
        createdAt: Date.now()
      };
      await userDBPut(admin);
      console.log('超级管理员账号已初始化');
    }else if(admin.password!==SUPER_ADMIN_PWD||admin.role!=='super_admin'){
      admin.password = SUPER_ADMIN_PWD;
      admin.role = 'super_admin';
      await userDBPut(admin);
    }
  }catch(e){console.error('初始化超级管理员失败:',e);}
}

// ========== 会话管理 ==========
function saveSession(user){
  localStorage.setItem('sm_session', JSON.stringify({
    phone: user.phone,
    name: user.name,
    role: user.role,
    loginAt: Date.now()
  }));
}
function loadSession(){
  try{
    const s = localStorage.getItem('sm_session');
    if(!s)return null;
    return JSON.parse(s);
  }catch(e){return null;}
}
function clearSession(){
  localStorage.removeItem('sm_session');
}

// ========== 多账号记忆 ==========
const REMEMBERED_USERS_KEY = 'sm_remembered_users';

function getRememberedUsers(){
  try{
    const raw = localStorage.getItem(REMEMBERED_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}

function saveRememberedUser(phone, password, name, role){
  let users = getRememberedUsers();
  const idx = users.findIndex(u => u.phone === phone);
  const entry = { phone, password: password||'', name: name||'', role: role||'normal', lastLogin: Date.now() };
  if(idx >= 0){
    users[idx] = entry;
  } else {
    users.push(entry);
  }
  // 按最后登录时间倒序排列
  users.sort((a,b) => b.lastLogin - a.lastLogin);
  localStorage.setItem(REMEMBERED_USERS_KEY, JSON.stringify(users));
}

function fillRememberedAccounts(){
  // 为所有手机号输入框绑定下拉账号选择
  const phoneInputs = ['loginPhone','regPhone'];
  phoneInputs.forEach(id => {
    const input = document.getElementById(id);
    if(!input) return;
    // 避免重复绑定
    if(input.dataset.acBound) return;
    input.dataset.acBound = '1';
    input.addEventListener('focus', ()=> showAccountDropdown(input));
    input.addEventListener('blur', ()=> setTimeout(()=> hideAccountDropdown(), 200));
    // input 输入时也需要更新下拉（过滤）
    input.addEventListener('input', ()=> showAccountDropdown(input));
  });
}

function showAccountDropdown(inputEl){
  let dropdown = document.getElementById('accountDropdown');
  if(!dropdown){
    dropdown = document.createElement('div');
    dropdown.id = 'accountDropdown';
    dropdown.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.18);max-height:220px;overflow-y:auto;display:none;min-width:220px;';
    document.body.appendChild(dropdown);
  }
  const users = getRememberedUsers();
  // 始终显示所有已保存账号，不再按输入内容过滤
  if(users.length === 0){
    dropdown.style.display = 'none';
    return;
  }

  // 定位到 input 下方
  const rect = inputEl.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = Math.max(rect.width, 260) + 'px';
  dropdown.style.display = 'block';

  const currentPhone = (inputEl.value||'').trim();
  dropdown.innerHTML = users.map(u => {
    const isActive = u.phone === currentPhone;
    return `<div class="ac-item" data-phone="${u.phone}" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;border-bottom:1px solid #f0f0f0;transition:background .15s;${isActive?'background:#e8f4fd;':''}" onmouseover="this.style.background='#f5f7fa'" onmouseout="this.style.background='${isActive?'#e8f4fd':''}'">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">${(u.name||u.phone).charAt(0)}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(u.name||u.phone)}</div>
        <div style="font-size:11px;color:var(--text3);font-family:monospace;">${escHtml(u.phone)}</div>
      </div>
    </div>`;
  }).join('') + `<div style="padding:6px 12px;font-size:11px;color:var(--text3);border-top:1px solid #f0f0f0;background:#fafbfc;">点击账号自动填充手机号和密码</div>`;

  // 绑定点击事件
  dropdown.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const phone = item.dataset.phone;
      const user = users.find(u => u.phone === phone);
      if(user){
        inputEl.value = phone;
        // 找到同一组里的密码框并填充
        const pwdInput = findPwdInput(inputEl);
        if(pwdInput && user.password){
          pwdInput.value = user.password;
        }
      }
      dropdown.style.display = 'none';
    });
  });
}

function findPwdInput(phoneInput){
  // 查找同一 .auth-panel 里的密码输入框
  const panel = phoneInput.closest('.auth-panel');
  if(!panel) return null;
  return panel.querySelector('input[type="password"]');
}

function hideAccountDropdown(){
  const dropdown = document.getElementById('accountDropdown');
  if(dropdown) dropdown.style.display = 'none';
}


// ========== 登录/注册 UI 逻辑 ==========
// ========== 登录页面显示/隐藏 ==========
function showLogin(){
  // 显示登录页，隐藏主应用
  const loginPage = document.getElementById('loginPage');
  if(loginPage) loginPage.style.display = 'flex';
  // 隐藏主应用
  const mainApp = document.getElementById('mainApp');
  if(mainApp) mainApp.style.display = 'none';
  // 隐藏顶部栏（在 mainApp 外部，需单独处理）
  const header = document.querySelector('.header');
  if(header) header.style.display='none';
  const topNav = document.getElementById('topNav');
  if(topNav) topNav.style.display='none';
  const sysNav = document.getElementById('systemSubNav');
  if(sysNav) sysNav.style.display='none';
  // 默认显示登录标签
  switchAuthTab('login');
  // 自动填入上次登录的账号密码
  const remembered = getRememberedUsers();
  if(remembered.length > 0){
    // 取最后一个登录的账号（lastLogin 最大的）
    const lastUser = remembered[0];
    const phoneInput = document.getElementById('loginPhone');
    const pwdInput = document.getElementById('loginPwd');
    if(phoneInput) phoneInput.value = lastUser.phone || '';
    if(pwdInput && lastUser.password) pwdInput.value = lastUser.password || '';
  } else {
    // 没有记住的账号，清空表单
    ['loginPhone','loginPwd','regPhone','regPwd','regPwd2'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.value = '';
    });
  }
  ['loginError','regError'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.textContent = '';
  });
}
function hideLogin(){
  // 隐藏登录页，显示主应用
  const loginPage = document.getElementById('loginPage');
  if(loginPage) loginPage.style.display = 'none';
  const mainApp = document.getElementById('mainApp');
  if(mainApp) mainApp.style.display = '';
}

// ========== 切换登录/注册主标签 ==========
function switchAuthTab(tab){
  const loginPage = document.getElementById('loginPage');
  if(!loginPage) return;
  // 更新标签按钮
  const tabBtns = loginPage.querySelectorAll(':scope > .login-card > .login-tabs > .tab-btn');
  tabBtns.forEach(t => t.classList.remove('active'));
  if(tab === 'login' && tabBtns[0]) tabBtns[0].classList.add('active');
  if(tab === 'register' && tabBtns[1]) tabBtns[1].classList.add('active');
  if(tab === 'find' && tabBtns[2]) tabBtns[2].classList.add('active');
  // 显示对应面板
  const authLogin = document.getElementById('authLogin');
  const authRegister = document.getElementById('authRegister');
  const authFind = document.getElementById('authFind');
  if(authLogin) authLogin.classList.toggle('active', tab === 'login');
  if(authRegister) authRegister.classList.toggle('active', tab === 'register');
  if(authFind) authFind.classList.toggle('active', tab === 'find');
}


function showRegister(){
  // 切换到注册标签（登录和注册在同一个页面中）
  if(typeof switchAuthTab === 'function') switchAuthTab('register');
  const loginPage = document.getElementById('loginPage');
  if(loginPage) loginPage.style.display = 'flex';
}
function closeRegister(){
  // 切换到登录标签
  if(typeof switchAuthTab === 'function') switchAuthTab('login');
}

// ========== 退出登录 ==========
function logout(){
  if(!confirm('确定退出登录？')) return;
  addSysLog('login','退出登录');
  currentUser = null;
  try{ localStorage.removeItem('nslg_session'); }catch(e){}
  showLogin();
}


// ========== 密码登录 ==========

// ========== 密码登录 ==========
async function doLoginPwd(){
  const phone = document.getElementById('loginPhone').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const msgEl = document.getElementById('loginError');
  msgEl.className='msg-err';msgEl.textContent='';
  if(!phone||!pwd){msgEl.textContent='请填写手机号和密码';return;}
  try{
    const user = await userDBGet(phone);
    if(!user){msgEl.textContent='该手机号未注册';return;}
    if(user.password!pwd){msgEl.textContent='密码错误';return;}
    // 登录成功（本地）
    currentUser = user;
    saveSession(user);
    saveRememberedUser(phone, pwd, user.name, user.role);
    addSysLog('login','密码登录成功');
    // 同时尝试云端登录，获取 JWT token
    try {
      if (typeof cloudLogin === 'function') {
        const cloudUser = await cloudLogin(phone, pwd);
        if (cloudUser) {
          console.log('[Login] 云端登录成功，JWT token 已保存');
        }
      }
    } catch (cloudErr) {
      console.warn('[Login] 云端登录失败，继续使用本地模式:', cloudErr.message);
    }
    onLoginSuccess();
  }catch(e){msgEl.textContent='登录失败：'+e.message;}
}


// ========== 密码注册 ==========
async function doRegPwd(){
  const phone  = document.getElementById('regPhone').value.trim();
  const pwd1   = document.getElementById('regPwd').value;
  const pwd2   = document.getElementById('regPwd2').value;
  const msgEl  = document.getElementById('regError');
  msgEl.className='msg-err';msgEl.textContent='';
  const name = document.getElementById('regName')?.value?.trim() || '';
  if(!/^1[3-9]\d{9}$/.test(phone)){msgEl.textContent='手机号格式不正确';return;}
  if(pwd1.length<6){msgEl.textContent='密码至少6位';return;}
  if(pwd1!==pwd2){msgEl.textContent='两次密码不一致';return;}
  try{
    const exist = await userDBGet(phone);
    if(exist){msgEl.textContent='该手机号已注册，请直接登录';return;}
    const user = {
      phone,
      name: name||`用户${phone.slice(-4)}`,
      password: pwd1,
      role: 'member',
      avatar: '',
      points: 18,
      createdAt: Date.now()
    };
    await userDBPut(user);
    msgEl.className='msg-suc';
    msgEl.textContent='注册成功！即将自动登录...（已赠送18积分）';
    saveRememberedUser(phone, pwd1, user.name, 'member');
    addSysLog('action', '密码注册新用户: '+phone);
    setTimeout(()=>{currentUser=user;saveSession(user);closeRegister();onLoginSuccess();},1200);
  }catch(e){msgEl.textContent='注册失败：'+e.message;}
}



// ========== 登录成功 ==========
// ========== 导航权限控制 ==========
function updateNavByRole(){
  const navSystem    = document.getElementById('navSystemBtn');
  const navProject   = document.getElementById('navProjectBtn');
  const navLibrary   = document.getElementById('navLibraryBtn');
  const navRanking   = document.getElementById('navRankingBtn');
  const navPeijiang  = document.getElementById('navPeijiangBtn');
  const navYanwu     = document.getElementById('navYanwuBtn');
  if(!currentUser){
    // 未登录：全部顶级导航隐藏
    if(navProject)  navProject.style.display='none';
    if(navSystem)   navSystem.style.display='none';
    if(navLibrary)  navLibrary.style.display='none';
    if(navRanking)  navRanking.style.display='none';
    if(navPeijiang) navPeijiang.style.display='none';
    if(navYanwu)    navYanwu.style.display='none';
    document.getElementById('systemSubNav').style.display='none';
    document.getElementById('pointsMallBtn').style.display='none';
    return;
  }
  // 项目管理：所有登录用户可见
  if(navProject)  navProject.style.display='inline-block';
  // 武将战法库/数值排行/配将助手/演武助手：所有登录用户可见
  if(navLibrary)  navLibrary.style.display='inline-block';
  if(navRanking)  navRanking.style.display='inline-block';
  if(navPeijiang) navPeijiang.style.display='inline-block';
  if(navYanwu)    navYanwu.style.display='inline-block';
  // 系统配置：仅超级管理员可见
  if(navSystem) navSystem.style.display = currentUser.role==='super_admin' ? 'inline-block' : 'none';
  // 积分商城：所有登录用户可见
  const mallBtn = document.getElementById('pointsMallBtn');
  if(mallBtn) mallBtn.style.display='inline-block';
  // 更新积分数显示
  updateUserNavPoints();
}

// 更新右上角积分显示
function updateUserNavPoints(){
  const navPoints = document.getElementById('navPoints');
  if(!navPoints || !currentUser) return;
  const pts = currentUser.points || 0;
  navPoints.textContent = '💎 ' + pts + '分';
  navPoints.style.display = 'inline-block';
}

async function onLoginSuccess(){
  hideLogin();
  const mainApp = document.getElementById('mainApp');
  if(mainApp) mainApp.style.display='block';
  // 显示顶部栏（showLogin 中已隐藏）
  const header = document.querySelector('.header');
  if(header) header.style.display='';
  const topNav = document.getElementById('topNav');
  if(topNav) topNav.style.display='';
  // 清除之前退出时残留的 inline display 样式，确保 tab 内容能正常显示
  // 注意：不能设成 ''，否则 CSS 的 .tab-content{display:none} 会重新生效
  // 这里只清除 projectBar 等元素的残留样式，tab-content 的显示由 showTab() 控制
  var mainTab = document.getElementById('tab-project');
  if(mainTab) mainTab.style.display='block'; // 默认显示项目 tab
  // 设置用户角色样式
  if(currentUser.role==='super_admin'){
    document.body.classList.add('super-admin');
  }else{
    document.body.classList.remove('super-admin');
  }
  // 更新右上角用户信息
  renderUserBar();
  // 更新导航权限显示
  updateNavByRole();
  // 登录成功后加载战报数据（带上正确的 currentUser）
  if(typeof dataInit==='function'){
    dataInit();
  }
  
  // ========== 项目云同步（与角色同步机制一致）==========
  // 登录成功后从云端同步项目数据，确保跨浏览器可见
  if(window.cloudSync && window.cloudSync.syncToLocal){
    try{
      console.log('[onLoginSuccess] 开始同步云端项目数据...');
      const syncResult = await window.cloudSync.syncToLocal();
      console.log('[onLoginSuccess] 云端项目同步完成:', syncResult);
    }catch(e){
      console.error('[onLoginSuccess] 云端项目同步失败:', e);
    }
  }
  
  // 默认进入项目管理页
  showProjectHome();
}

// ========== 渲染用户栏 ==========
// ========== 渲染用户栏（右上角）==========
// 异步版本：从 roles DB 读取角色名
async function renderUserBar(){
  let bar = document.getElementById('userBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id='userBar';
    bar.style.cssText='display:flex;align-items:center;gap:10px;font-size:12px;';
    const header = document.querySelector('.header');
    if(header){header.appendChild(bar);}
  }
  bar.innerHTML='';
  if(!currentUser){bar.style.display='none';return;}
  bar.style.display='flex';
  // 读取角色名称
  let roleName = currentUser.role||'member';
  try{
    const role = await roleDBGet(currentUser.role);
    if(role) roleName = role.name;
  }catch(e){}
  const roleColor  = currentUser.role==='super_admin'?'var(--purple)':'var(--accent)';
  const avatarChar = (currentUser.name||currentUser.phone||'?').charAt(0);
  bar.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:30px;height:30px;border-radius:50%;background:${roleColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;">${escHtml(avatarChar)}</div>
      <div style="display:flex;flex-direction:column;line-height:1.35;">
        <span style="font-size:13px;font-weight:500;color:var(--text);">${escHtml(currentUser.name)||escHtml(currentUser.phone)}</span>
        <span style="font-size:10px;color:${roleColor};opacity:.85;">${escHtml(roleName)}</span>
      </div>
    </div>
    <button class="btn btn-sm" style="margin-left:6px;padding:3px 10px;font-size:11px;background:rgba(255,82,82,.08);color:#ff5252;border:1px solid rgba(255,82,82,.18);border-radius:4px;cursor:pointer;" onclick="doLogout()">退出</button>
  `;
  // 更新右上角积分数显示
  if(typeof updateUserNavPoints==='function') updateUserNavPoints();
}

// ========== 退出登录 ==========
function doLogout(){
  addSysLog('login','用户退出登录');
  clearSession();
  currentUser=null;
  renderUserBar();
  updateNavByRole();
  // 隐藏子导航
  const projectSubNav = document.getElementById('projectSubNav');
  const systemSubNav = document.getElementById('systemSubNav');
  if(projectSubNav) projectSubNav.style.display='none';
  if(systemSubNav) systemSubNav.style.display='none';
  // 隐藏项目信息栏
  const bar = document.getElementById('projectBar');
  if(bar) bar.style.display='none';
  // 清除项目过滤
  window.currentProjectId = null;
  // 调用 showLogin 显示登录弹窗（会同时隐藏注册弹窗）
  if(typeof showLogin==='function'){showLogin();}
  else{
    const overlay=document.getElementById('loginOverlay');
    if(overlay)overlay.classList.remove('hidden');
    const reg=document.getElementById('registerModal');
    if(reg)reg.style.display='none';
  }
}

// ========== 用户管理（需 userManage 权限）==========
async function renderUserManage(){
  if(!currentUser)return;
  const perms = await getRolePermissions(currentUser.role);
  if(!perms||!perms['userManage'])return;
  const users  = await userDBGetAll();
  const roles  = await roleDBGetAll();
  const tbody  = document.getElementById('userTableBody');
  if(!tbody) return;
  tbody.innerHTML = users.map(u=>{
    const isSuper = u.role==='super_admin';
    const avatarChar = (u.name||u.phone).charAt(0);
    const roleName = (roles.find(r=>r.id===u.role)||{}).name || u.role || 'member';
    // 角色下拉框（超级管理员不可改）
    let roleSel = '';
    if(isSuper){
      roleSel = '<span class="role-badge super">超级管理员（内置）</span>';
    }else{
      roleSel = '<select onchange="changeUserRole(\''+u.phone+'\',this.value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--text);font-size:12px;">';
      for(const r of roles){
        roleSel += '<option value="'+r.id+'" '+(u.role===r.id?'selected':'')+'>'+escHtml(r.name)+'</option>';
      }
      roleSel += '</select>';
    }
    return '<tr>'+
      '<td class="avatar-cell"><div class="avatar-circle '+(isSuper?'super':'normal')+'">'+avatarChar+'</div></td>'+
      '<td style="font-weight:bold;color:var(--text);">'+escHtml(u.name)+'</td>'+
      '<td style="font-family:monospace;color:var(--blue);">'+escHtml(u.phone)+'</td>'+
      '<td>'+roleSel+'</td>'+
      '<td><span style="color:var(--accent);font-weight:bold;">'+(u.points||0)+'</span> 分</td>'+
      '<td style="font-size:11px;color:var(--text3);">'+(u.createdAt?new Date(u.createdAt).toLocaleDateString('zh-CN'):'-')+'</td>'+
      '<td style="white-space:nowrap;"><div style="display:flex;gap:6px;align-items:center;">'+
        '<button class="btn-sm" onclick="openAdjustPointsModal(\''+u.phone+'\', '+(u.points||0)+')" title="调整积分">💎调分</button>'+
        '<button class="btn-sm" onclick="resetUserPwd(\''+u.phone+'\')">重置密码</button>'+
        (!isSuper?'<button class="btn-sm danger" onclick="deleteUser(\''+u.phone+'\')">删除</button>':'<span style="color:var(--text3);font-size:11px;">不可操作</span>')+
      '</div></td>'+
    '</tr>';
  }).join('');
}
// ========== 修改用户角色 ==========
async function changeUserRole(phone, newRoleId){
  if(!confirm('确认修改该用户的角色？')) return;
  try{
    const u = await userDBGet(phone);
    if(!u){alert('用户不存在');return;}
    u.role = newRoleId;
    await userDBPut(u);
    addSysLog('operation','修改用户角色: '+phone+' → '+newRoleId);
    await renderUserManage();
  }catch(e){alert('修改失败：'+e.message);}
}

async function resetUserPwd(phone){
  const newPwd = prompt(`请输入用户 ${phone} 的新密码（至少6位）：`);
  if(!newPwd||newPwd.length<6){if(newPwd!==null)alert('密码至少6位');return;}
  try{
    const user = await userDBGet(phone);
    if(!user){alert('用户不存在');return;}
    user.password = newPwd;
    await userDBPut(user);
    alert(`密码已重置为：${newPwd}`);
    addSysLog('action', '重置用户密码: '+phone);
  }catch(e){alert('操作失败：'+e.message);}
}

// ========== 积分调整 ==========
async function openAdjustPointsModal(phone, currentPoints) {
  const modal = document.getElementById('adjustPointsModal');
  if (!modal) return;
  document.getElementById('adjustPointsPhone').textContent = phone;
  document.getElementById('adjustPointsCurrent').textContent = currentPoints + ' 分';
  const input = document.getElementById('adjustPointsInput');
  if (input) input.value = '';
  const errEl = document.getElementById('adjustPointsError');
  if (errEl) errEl.textContent = '';
  modal.style.display = 'flex';
}

function closeAdjustPointsModal() {
  const modal = document.getElementById('adjustPointsModal');
  if (modal) modal.style.display = 'none';
}

async function doAdjustPoints() {
  const phoneEl = document.getElementById('adjustPointsPhone');
  const errEl = document.getElementById('adjustPointsError');
  const input = document.getElementById('adjustPointsInput');
  if (!phoneEl || !errEl || !input) return;
  const phone = phoneEl.textContent;
  const val = parseInt(input.value);
  if (isNaN(val) || val < 0) {
    errEl.textContent = '请输入有效的积分数量（非负整数）';
    return;
  }
  try {
    const u = await userDBGet(phone);
    if (!u) { errEl.textContent = '用户不存在'; return; }
    const oldPoints = u.points || 0;
    u.points = val;
    await userDBPut(u);
    // 如果是当前用户，同步内存中的积分
    if (currentUser && currentUser.phone === phone) {
      currentUser.points = val;
      saveSession(currentUser);
      if (typeof updateUserNavPoints === 'function') updateUserNavPoints();
    }
    addSysLog('operation', `调整用户积分: ${phone} ${oldPoints} → ${val}（差异: ${val - oldPoints}）`);
    errEl.style.color = 'var(--success, #4caf50)';
    errEl.textContent = '调整成功！';
    await renderUserManage();
    setTimeout(() => closeAdjustPointsModal(), 1000);
  } catch (e) {
    errEl.textContent = '调整失败：' + e.message;
  }
}

async function deleteUser(phone){
  if(!confirm('确定删除该用户？删除后该用户将无法登录。'))return;
  try{
    await userDBDelete(phone);
    renderUserManage();
    addSysLog('delete', '删除用户: '+phone);
  }catch(e){alert('删除失败：'+e.message);}
}

// ========== 新增用户弹窗 ==========
async function showAddUserModal(){
  const modal = document.getElementById('addUserModal');
  if(!modal) return;
  // 清空输入
  const nameEl  = document.getElementById('addUserName');
  const phoneEl = document.getElementById('addUserPhone');
  const pwdEl   = document.getElementById('addUserPwd');
  const errEl   = document.getElementById('addUserError');
  if(nameEl)  nameEl.value = '';
  if(phoneEl) phoneEl.value = '';
  if(pwdEl)   pwdEl.value = '';
  if(errEl)   { errEl.textContent = ''; errEl.className = 'msg-err'; }
  // 填充角色选择器
  const roleSel = document.getElementById('addUserRole');
  if(roleSel){
    roleSel.innerHTML = '<option value="">加载中...</option>';
    try {
      let roles = await roleDBGetAll();
      // 兜底：若 DB 中无角色，使用内置列表
      if(!roles || roles.length === 0){
        const BUILTIN = [
          {id:'super_admin', name:'超级管理员'},
          {id:'admin',       name:'管理员'},
          {id:'member',      name:'普通成员'},
        ];
        roles = BUILTIN;
      }
      roleSel.innerHTML = roles.map(r=>`<option value="${r.id}">${escHtml(r.name||r.id)}</option>`).join('');
      // 默认选中"普通成员"
      const memberOpt = [...roleSel.options].find(o => o.value === 'member');
      if(memberOpt) memberOpt.selected = true;
    } catch(e){
      roleSel.innerHTML = '<option value="member">普通成员（默认）</option>';
    }
  }
  modal.style.display = 'flex';
}

function closeAddUserModal(){
  const modal = document.getElementById('addUserModal');
  if(modal) modal.style.display = 'none';
}

async function doAddUser(){
  const nameEl  = document.getElementById('addUserName');
  const phoneEl = document.getElementById('addUserPhone');
  const pwdEl   = document.getElementById('addUserPwd');
  const roleEl  = document.getElementById('addUserRole');
  const errEl   = document.getElementById('addUserError');
  if(!errEl) return;
  errEl.className = 'msg-err';
  errEl.textContent = '';

  const name    = nameEl  ? nameEl.value.trim()  : '';
  const phone   = phoneEl ? phoneEl.value.trim() : '';
  const pwd     = pwdEl   ? pwdEl.value       : '';
  const roleId  = roleEl  ? roleEl.value        : 'member';

  if(!/^1[3-9]\d{9}$/.test(phone)){
    errEl.textContent = '请输入正确的手机号';
    return;
  }
  if(pwd.length < 6){
    errEl.textContent = '密码至少6位';
    return;
  }
  try {
    const exist = await userDBGet(phone);
    if(exist){
      errEl.textContent = '该手机号已注册';
      return;
    }
    const user = {
      phone,
      name: name || `用户${phone.slice(-4)}`,
      password: pwd,
      role: roleId || 'member',
      avatar: '',
      points: 18,
      createdAt: Date.now()
    };
    await userDBPut(user);
    errEl.className = 'msg-suc';
    errEl.textContent = '新增成功！（默认赠送18积分）';
    addSysLog('action', '新增用户: '+phone+' ('+(name||phone)+')');
    await renderUserManage();
    setTimeout(()=>{ closeAddUserModal(); }, 1000);
  } catch(e){
    errEl.textContent = '新增失败：' + e.message;
  }
}

// ========== 修改用户角色 ==========
async function changeUserRole(phone, newRoleId){
  if(!confirm('确定修改该用户的角色？')) return;
  try{
    const user = await userDBGet(phone);
    if(!user){alert('用户不存在');return;}
    user.role = newRoleId;
    await userDBPut(user);
    addSysLog('action', '修改用户角色: '+phone+' → '+newRoleId);
    // 如果修改的是当前登录用户，更新 currentUser 并刷新导航
    if(currentUser && currentUser.phone===phone){
      currentUser = user;
      saveSession(currentUser);
      updateNavByRole();
      renderUserBar();
    }
    renderUserManage();
  }catch(e){alert('修改失败：'+e.message);}
}

// ========== 启动检查 ==========
async function checkLoginState(){
  await ensureSuperAdmin();
  const session = loadSession();
  if(session){
    try{
      const user = await userDBGet(session.phone);
      if(user&&user.role===session.role){
        currentUser = user;
        addSysLog('login','自动登录（会话恢复）');
        onLoginSuccess();
        return;
      }
    }catch(e){}
  }
  // 未登录，显示登录界面
  showLogin();
}

// 在 DOMContentLoaded 后检查登录态
document.addEventListener('DOMContentLoaded', ()=>{
  fillRememberedAccounts();
  // 先不执行，等原 init() 里调用
});

// ========== 系统日志 ==========
const SYSLOG_DB = 'nslg_syslog';
const SYSLOG_STORE = 'logs';

function openSysLogDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(SYSLOG_DB, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(SYSLOG_STORE)){
        db.createObjectStore(SYSLOG_STORE, {keyPath:'id', autoIncrement:true});
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function addSysLog(type, detail){
  try{
    const db = await openSysLogDB();
    const tx = db.transaction([SYSLOG_STORE], 'readwrite');
    const store = tx.objectStore(SYSLOG_STORE);
    store.add({
      time: new Date().toLocaleString('zh-CN'),
      user: currentUser ? (currentUser.name||currentUser.phone) : '未知',
      phone: currentUser ? currentUser.phone : '',
      role: currentUser ? currentUser.role : '',
      type,  // login / action / delete
      detail,
      ua: navigator.userAgent.slice(0, 80)
    });
  }catch(e){ console.error('[SysLog] 写入失败:', e); }
}

async function getSysLogs(){
  try{
    const db = await openSysLogDB();
    const tx = db.transaction([SYSLOG_STORE], 'readonly');
    const req = tx.objectStore(SYSLOG_STORE).getAll();
    return new Promise((resolve,reject)=>{
      req.onsuccess = ()=>resolve(req.result||[]);
      req.onerror = ()=>reject(req.error);
    });
  }catch(e){ return []; }
}

async function renderSysLog(){
  const logs = await getSysLogs();
  const searchEl = document.getElementById('logSearch');
  const typeEl = document.getElementById('logType');
  const search = searchEl ? (searchEl.value||'').toLowerCase() : '';
  const typeFilter = typeEl ? typeEl.value : '';

  let filtered = logs.sort((a,b)=>b.id-a.id);
  if(search){
    filtered = filtered.filter(l=>(l.user||'').toLowerCase().includes(search)||(l.detail||'').toLowerCase().includes(search)||(l.phone||'').includes(search));
  }
  if(typeFilter){
    filtered = filtered.filter(l=>l.type===typeFilter);
  }

  const tbody = document.getElementById('sysLogBody');
  const emptyEl = document.getElementById('sysLogEmpty');
  if(!tbody) return;

  if(filtered.length===0){
    tbody.innerHTML='';
    if(emptyEl) emptyEl.style.display='block';
    return;
  }
  if(emptyEl) emptyEl.style.display='none';

  tbody.innerHTML = filtered.map(l=>{
    const badgeClass = l.type==='login'?'log-badge-login':l.type==='delete'?'log-badge-delete':'log-badge-action';
    const typeLabel = l.type==='login'?'登录':l.type==='delete'?'删除':'操作';
    const roleLabel = l.role==='super_admin'?'超管':'用户';
    return `<tr>
      <td style="white-space:nowrap;">${escHtml(l.time)}</td>
      <td>${escHtml(l.user)}<br><span style="font-size:10px;color:var(--text3);">${escHtml(l.phone)}</span></td>
      <td><span style="font-size:11px;color:${l.role==='super_admin'?'var(--purple)':'var(--text2)'};">${roleLabel}</span></td>
      <td><span class="${badgeClass}">${typeLabel}</span></td>
      <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(l.detail)}</td>
      <td style="font-size:10px;color:var(--text3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(l.ua||'-')}</td>
    </tr>`;
  }).join('');
}

function exportSysLog(){
  getSysLogs().then(logs=>{
    if(logs.length===0){alert('暂无日志');return;}
    const header = '时间,用户,手机号,角色,操作类型,详情,设备\n';
    const rows = logs.map(l=>`"${l.time}","${l.user}","${l.phone}","${l.role}","${l.type}","${(l.detail||'').replace(/"/g,'""')}","${(l.ua||'').replace(/"/g,'""')}"`).join('\n');
    const blob = new Blob(['\uFEFF'+header+rows], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '系统日志_'+new Date().toLocaleDateString('zh-CN')+'.csv';
    a.click();
  });
}

// ========== 数据导出/导入（备份与迁移） ==========

async function exportAllData(){
  const statusEl = document.getElementById('dataMgmtStatus');
  try{
    if(statusEl) statusEl.textContent = '⏳ 正在读取数据...';
    // 1. 战报数据
    let records = [];
    try{ records = await dbGetAll(); }catch(e){ console.warn('读取战报数据失败:', e); }
    // 2. 用户数据
    let users = [];
    try{ users = await userDBGetAll(); }catch(e){ console.warn('读取用户数据失败:', e); }
    // 3. 项目数据
    let projects = [];
    try{ projects = await projDBGetAll(); }catch(e){ console.warn('读取项目数据失败:', e); }
    // 4. 系统日志
    let logs = [];
    try{ logs = await getSysLogs(); }catch(e){ console.warn('读取系统日志失败:', e); }

    const allData = {
      version: 1,
      exportDate: new Date().toISOString(),
      data: {
        SanmoBattleDB: { records: records },
        SanMoUserDB: { users: users, projects: projects },
        nslg_syslog: { logs: logs }
      }
    };

    const json = JSON.stringify(allData);
    const blob = new Blob([json], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nslg-backup-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);

    const summary = `战报 ${records.length} 条 / 用户 ${users.length} 个 / 项目 ${projects.length} 个 / 日志 ${logs.length} 条`;
    if(statusEl) statusEl.textContent = '✅ 导出成功！' + summary;
    alert('数据导出成功！\n' + summary);
  }catch(e){
    console.error('导出失败:', e);
    if(statusEl) statusEl.textContent = '❌ 导出失败：' + e.message;
    alert('导出失败：' + e.message);
  }
}

async function importAllData(file){
  if(!file){ alert('请选择备份文件'); return; }
  const statusEl = document.getElementById('dataMgmtStatus');
  try{
    if(statusEl) statusEl.textContent = '⏳ 正在读取备份文件...';
    const text = await file.text();
    const allData = JSON.parse(text);
    if(!allData.version || !allData.data){ throw new Error('无效的备份文件格式'); }

    if(!confirm('导入将覆盖同 ID 的现有数据，确定继续？')){ if(statusEl) statusEl.textContent = '已取消导入'; return; }

    let importCount = { records:0, users:0, projects:0, logs:0 };

    // 1. 导入战报数据
    if(allData.data.SanmoBattleDB && allData.data.SanmoBattleDB.records){
      const db = await openDB();
      const tx = db.transaction(['records'], 'readwrite');
      const store = tx.objectStore('records');
      for(const rec of allData.data.SanmoBattleDB.records){
        store.put(rec);
        importCount.records++;
      }
      await new Promise((resolve, reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
    }

    // 2. 导入用户和项目数据
    if(allData.data.SanMoUserDB){
      const udb = await openUserDB();
      // 用户
      if(allData.data.SanMoUserDB.users){
        const tx = udb.transaction(['users'], 'readwrite');
        const store = tx.objectStore('users');
        for(const u of allData.data.SanMoUserDB.users){
          store.put(u);
          importCount.users++;
        }
        await new Promise((resolve, reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
      }
      // 项目
      if(allData.data.SanMoUserDB.projects){
        const tx = udb.transaction(['projects'], 'readwrite');
        const store = tx.objectStore('projects');
        for(const p of allData.data.SanMoUserDB.projects){
          store.put(p);
          importCount.projects++;
        }
        await new Promise((resolve, reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
      }
    }

    // 3. 导入系统日志
    if(allData.data.nslg_syslog && allData.data.nslg_syslog.logs){
      const sdb = await openSysLogDB();
      const tx = sdb.transaction([SYSLOG_STORE], 'readwrite');
      const store = tx.objectStore(SYSLOG_STORE);
      for(const l of allData.data.nslg_syslog.logs){
        store.put(l);
        importCount.logs++;
      }
      await new Promise((resolve, reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
    }

    const summary = `战报 ${importCount.records} 条 / 用户 ${importCount.users} 个 / 项目 ${importCount.projects} 个 / 日志 ${importCount.logs} 条`;
    if(statusEl) statusEl.textContent = '✅ 导入成功！' + summary;
    alert('数据导入成功！\n' + summary + '\n\n请按 Ctrl+F5 刷新页面使数据生效。');

    // 记录导入操作
    await addSysLog('action', '导入备份数据: ' + summary);

  }catch(e){
    console.error('导入失败:', e);
    if(statusEl) statusEl.textContent = '❌ 导入失败：' + e.message;
    alert('导入失败：' + e.message);
  }
}

// 在关键操作点自动记录日志



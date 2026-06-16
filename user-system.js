/* ==========================================================
   USER SYSTEM - 用户登录、注册、用户管理
   ========================================================== */

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
  if(!phone){return Promise.resolve(null);}
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

// 获取用户积分（优先从云端获取，失败后回退到本地）
async function getUserPoints(phone){
  // 优先从云端获取最新积分
  try {
    const token = getToken();
    if (token && typeof cloudRequest === 'function') {
      // 修复：/api/auth/profile 有 bug，改用 /api/users 获取用户积分
      const res = await cloudRequest('/users');
      if (res && res.code === 200 && res.data) {
        const list = Array.isArray(res.data) ? res.data : ((res.data && res.data.list) || []);
        const cloudUser = list.find(u => u.phone === phone);
        if (cloudUser && cloudUser.points !== undefined) {
          const cloudPoints = cloudUser.points;
          // 同步到本地
          const u = await userDBGet(phone);
          if (u && u.points !== cloudPoints) {
            u.points = cloudPoints;
            await userDBPut(u);
            if (currentUser && currentUser.phone === phone) {
              currentUser.points = cloudPoints;
            }
          }
          return cloudPoints;
        }
      }
    }
  } catch (e) {
    console.warn('[getUserPoints] 云端获取失败，使用本地缓存:', e.message);
  }
  // 回退到本地
  const u = await userDBGet(phone);
  return u ? (u.points || 0) : 0;
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
    return userDBPut(u).then(()=>{
      // 同步到云端
      if (window.cloudSync && typeof window.cloudSync.updateUserPoints === 'function') {
        window.cloudSync.updateUserPoints(phone, u.points).catch(e => console.error('[积分同步] 云端更新失败:', e));
      }
      return u.points;
    });
  });
}

// 扣减用户积分（OCR 上传时调用），返回是否成功
// 始终先从云端获取最新积分，确保使用管理员最新调整后的值
async function deductUserPoints(phone, amount){
  // 1. 从云端拉最新积分（getUserPoints 会自动同步到 IndexedDB 和 currentUser）
  const freshPoints = await getUserPoints(phone);
  console.log('[deductUserPoints] 云端最新积分:', freshPoints, '需扣减:', amount);
  if(freshPoints < amount) return false; // 积分不足

  // 2. 扣减并保存
  const u = await userDBGet(phone);
  if(!u) throw new Error('用户不存在: '+phone);
  u.points = freshPoints - amount;
  if(currentUser && currentUser.phone === phone){
    currentUser.points = u.points;
    saveSession(currentUser);
    if(typeof updateUserNavPoints === 'function') updateUserNavPoints(); // 立即更新右上角显示
  }
  await userDBPut(u);

  // 3. 异步同步到云端
  if(window.cloudSync && typeof window.cloudSync.updateUserPoints === 'function'){
    window.cloudSync.updateUserPoints(phone, u.points, {type:'consume', description:'用户消费'})
      .catch(e => console.error('[积分同步] 云端更新失败:', e));
  }
  return true;
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
      const store = tx.objectStore('projects');
      // 先按原类型查找
      const req = store.get(id);
      req.onsuccess = (e)=>{
        let result = e.target.result;
        if(!result && id != null && id !== ''){
          // 类型不匹配时尝试转换后查找（数字↔字符串），但排除无效 key
          const altId = typeof id === 'string' ? Number(id) : String(id);
          // 排除 NaN 和 "undefined"/"null" 字符串
          if(altId !== '' && altId !== 'undefined' && altId !== 'null' && !isNaN(altId)){
            const req2 = store.get(altId);
            req2.onsuccess = (e2)=>resolve(e2.target.result||null);
            req2.onerror   = ()=>resolve(null);
          } else {
            resolve(null);
          }
        } else {
          resolve(result||null);
        }
      };
      req.onerror = ()=>resolve(null);
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
    points: user.points || 0,  // 同步积分到会话（用于自动登录时恢复）
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
window.showLogin = function showLogin(){
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
function closeRegister(){
  hideLogin();
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




// ========== 密码登录 ==========
window.doLoginPwd = async function doLoginPwd(){
  const phone = document.getElementById('loginPhone').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const msgEl = document.getElementById('loginError');
  msgEl.className='msg-err';msgEl.textContent='';
  if(!phone||!pwd){msgEl.textContent='请填写手机号和密码';return;}
  try{
    // 先查本地 IndexedDB
    let user = await userDBGet(phone);

    if(user){
      // 本地有记录但密码为空（云同步覆盖），走云端验证
      if(!user.password){
        console.log('[Login] 本地密码为空，走云端验证:', phone);
        if(typeof cloudLogin === 'function'){
          const cloudUser = await cloudLogin(phone, pwd);
          if(!cloudUser){ msgEl.textContent='密码错误'; return; }
          user.password = pwd;
          await userDBPut(user);
        }
      } else if(user.password != pwd){
        msgEl.textContent='密码错误'; return;
      }

      // 本地密码验证通过后，必须通过云端确认账号仍然有效
      // （防止已被删除/禁用的账号凭本地缓存继续登录）
      if(typeof cloudLogin === 'function'){
        try{
          const cloudUser = await cloudLogin(phone, pwd);
          if(cloudUser === null){
            // 云端明确拒绝：账号已被删除或密码已更改
            console.warn('[Login] 云端拒绝登录，清理本地缓存:', phone);
            try{ await userDBDelete(phone); }catch(e){}
            try{ clearSession(); }catch(e){}
            msgEl.textContent='该账号已被删除或禁用，请联系管理员';
            return;
          }
          // 云端验证通过，同步最新数据
          let updated = false;
          if(cloudUser.points !== undefined && cloudUser.points !== user.points){ user.points = cloudUser.points; updated = true; }
          if(cloudUser.avatar !== undefined && cloudUser.avatar !== user.avatar){ user.avatar = cloudUser.avatar; updated = true; }
          if(cloudUser.status !== undefined && cloudUser.status !== user.status){ user.status = cloudUser.status; updated = true; }
          if(cloudUser.nickname || cloudUser.name){
            const n = cloudUser.nickname || cloudUser.name;
            if(n !== user.name){ user.name = n; updated = true; }
          }
          if(updated) await userDBPut(user);
        }catch(cloudErr){
          // 网络不可用时允许离线模式，但不允许账号状态为0时继续
          if(user.status === 0){
            msgEl.textContent='该账号已被禁用，请联系管理员';
            return;
          }
          console.warn('[Login] 云端验证失败，使用离线模式:', cloudErr.message);
        }
      }
    } else {
      // 本地无记录 → 必须走云端登录（支持后台直接创建的账号 / 跨设备登录）
      console.log('[Login] 本地无此用户，尝试云端验证:', phone);
      if(typeof cloudLogin === 'function'){
        const cloudUser = await cloudLogin(phone, pwd);
        if(!cloudUser){
          msgEl.textContent='该手机号未注册或密码错误';
          return;
        }
        // 云端验证通过，构建本地用户对象并写入 IndexedDB
        user = {
          phone: cloudUser.phone || phone,
          name: cloudUser.nickname || cloudUser.name || phone,
          password: pwd,
          role: cloudUser.role || 'member',
          points: cloudUser.points || 0,
          avatar: cloudUser.avatar || '',
          status: cloudUser.status !== undefined ? cloudUser.status : 1,
          createdAt: cloudUser.createdAt || Date.now()
        };
        await userDBPut(user);
        console.log('[Login] 云端用户已同步到本地 IndexedDB');
        addSysLog('login','云端登录成功（本地自动注册）');
      } else {
        msgEl.textContent='该手机号未注册';
        return;
      }
    }

    // 登录成功
    currentUser = user;
    saveSession(user);
    saveRememberedUser(phone, pwd, user.name, user.role);
    addSysLog('login','密码登录成功');
    startSessionHeartbeat();
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

    // 同步到云端（注册时创建云端用户）
    let cloudUser = null;
    try {
      console.log('[doRegPwd] window.cloudSync 存在?', !!window.cloudSync, '| createUser 类型:', typeof window?.cloudSync?.createUser);
      if (window.cloudSync && typeof window.cloudSync.createUser === 'function') {
        console.log('[doRegPwd] 准备调用 cloudSync.createUser:', phone, name||`用户${phone.slice(-4)}`, 'member');
        const createResult = await window.cloudSync.createUser(phone, name||`用户${phone.slice(-4)}`, pwd1, 'member');
        console.log('[doRegPwd] 云端用户创建结果:', createResult);

        // 注册成功后立即登录，获取 token 和云端最新积分
        if (createResult && typeof cloudLogin === 'function') {
          console.log('[doRegPwd] 注册成功，立即登录获取 token 和积分...');
          cloudUser = await cloudLogin(phone, pwd1);
          if (cloudUser && cloudUser.points !== undefined) {
            console.log('[doRegPwd] 登录成功，云端积分:', cloudUser.points);
            // 同步云端积分到本地（确保一致）
            if (cloudUser.points !== user.points) {
              user.points = cloudUser.points;
              await userDBPut(user);
            }
          }
        }
      } else {
        console.warn('[doRegPwd] cloudSync.createUser 不可用，跳过云端同步');
      }
    } catch (cloudErr) {
      console.error('[doRegPwd] 云端用户创建或登录失败（本地已保存）:', cloudErr);
      // 不阻塞注册流程，本地已保存
    }

    msgEl.className='msg-suc';
    msgEl.textContent='注册成功！';
    saveRememberedUser(phone, pwd1, user.name, 'member');
    addSysLog('action', '密码注册新用户: '+phone);

    // 赠送积分弹窗——要求用户主动确认
    const _regOverlay = document.createElement('div');
    _regOverlay.className = 'confirm-overlay';
    _regOverlay.innerHTML = `
      <div class="confirm-panel" style="text-align:center;max-width:360px;">
        <div class="confirm-header" style="justify-content:center;border-bottom:none;padding-bottom:4px;">
          <h3 class="confirm-title" style="font-size:20px;">🎉 注册成功！</h3>
        </div>
        <div class="confirm-body" style="padding:4px 22px 16px;">
          <div style="background:linear-gradient(135deg,#0d2a0d,#1a3a1a);border:2px solid #4caf50;border-radius:14px;padding:22px 16px;margin-bottom:12px;">
            <div style="font-size:13px;color:#81c784;margin-bottom:6px;">🎁 新用户免费赠送</div>
            <div style="font-size:56px;font-weight:bold;color:#4caf50;line-height:1;text-shadow:0 0 20px rgba(76,175,80,.5);">${user.points || 18}</div>
            <div style="font-size:15px;color:#a5d6a7;margin-top:8px;font-weight:bold;">积 分</div>
            <div style="font-size:12px;color:#66bb6a;margin-top:6px;">已自动存入您的账户</div>
          </div>
          <div style="font-size:12px;color:var(--text3);line-height:1.6;">积分可用于解锁战报高级分析功能<br>欢迎加入三谋！</div>
        </div>
        <div class="confirm-footer" style="justify-content:center;padding-bottom:20px;">
          <button id="_regSuccessOkBtn" class="confirm-btn confirm" style="flex:0 0 auto;min-width:180px;font-size:15px;padding:12px 24px;">✓ 好的，开始使用！</button>
        </div>
      </div>
    `;
    document.body.appendChild(_regOverlay);
    document.getElementById('_regSuccessOkBtn').onclick = function(){
      _regOverlay.remove();
      // 确保积分正确
      currentUser = user;
      // 立即更新右上角显示（不需要等 onLoginSuccess 的异步积分刷新）
      if(typeof updateUserNavPoints === 'function') updateUserNavPoints();
      saveSession(currentUser);
      closeRegister();
      onLoginSuccess();
    };
  }catch(e){msgEl.textContent='注册失败：'+e.message;}
}



// ========== 登录成功 ==========// ========== 导航权限控制 ==========
// updateNavByRole 由 role-system.js 统一提供

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
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.setProperty('display', 'none', 'important');
    el.classList.remove('active');
  });
  var mainTab = document.getElementById('tab-project');
  if(mainTab) mainTab.style.setProperty('display', 'block', 'important'); // 默认显示项目 tab
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
  // 异步从云端拉最新积分（管理员可能已调整），完成后刷新右上角显示
  if(currentUser && currentUser.phone && typeof getUserPoints === 'function'){
    getUserPoints(currentUser.phone).then(() => {
      if(typeof updateUserNavPoints === 'function') updateUserNavPoints();
    }).catch(e => console.warn('[onLoginSuccess] 积分刷新失败:', e.message));
  }
  // ① 先确保 IndexedDB 打开（openDB 必须完成才能写入战报数据）
  if(typeof openDB==='function') await openDB();

  // ② 加载本地已有数据先展示（不阻塞云端同步）
  if(typeof loadAllRecords==='function') await loadAllRecords();

  // ③ 从云端拉取最新数据（覆盖/补全本地）
  if(window.cloudSync && window.cloudSync.syncToLocal){
    try{
      console.log('[onLoginSuccess] 开始同步云端数据...');
      const syncResult = await window.cloudSync.syncToLocal();
      console.log('[onLoginSuccess] 云端同步完成:', syncResult);
    }catch(e){
      console.error('[onLoginSuccess] 云端同步失败:', e);
    }
  }

  // ④ 同步完成后刷新项目栏 + 战报视图
  if(typeof renderProjectSwitcher === 'function') await renderProjectSwitcher();
  if(typeof loadAllRecords === 'function'){
    await loadAllRecords();
    if(typeof renderDataTable === 'function') renderDataTable();
    if(typeof renderGallery === 'function') renderGallery();
  }

  // ⑤ 刷新项目管理页面（页面刷新后首次进入需要渲染项目列表）
  if(typeof renderProjectManage === 'function') await renderProjectManage();

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
      <div class="header-username" style="display:flex;flex-direction:column;line-height:1.35;">
        <span style="font-size:13px;font-weight:500;color:var(--text);">${escHtml(currentUser.name)||escHtml(currentUser.phone)}</span>
        <span style="font-size:10px;color:${roleColor};opacity:.85;">${escHtml(roleName)}</span>
      </div>
    </div>
    <button class="btn btn-sm" style="margin-left:6px;padding:3px 10px;font-size:11px;background:rgba(255,82,82,.08);color:#ff5252;border:1px solid rgba(255,82,82,.18);border-radius:4px;cursor:pointer;" onclick="doLogout()">退出</button>
  `;
  // 更新右上角积分数显示
  if(typeof updateUserNavPoints==='function') updateUserNavPoints();
}

// ========== 会话心跳检测 ==========
let _sessionHeartbeatTimer = null;

function startSessionHeartbeat() {
  stopSessionHeartbeat();
  _sessionHeartbeatTimer = setInterval(async () => {
    if (!currentUser) { stopSessionHeartbeat(); return; }
    try {
      // 调用 /api/auth/profile 验证当前账号是否仍然有效
      const token = typeof getToken === 'function' ? getToken() : '';
      const apiBase = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'https://api.zhenwu.fun/api';
      const resp = await fetch(`${apiBase}/auth/profile`, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      const data = await resp.json();
      if (data && data.code === 401) {
        stopSessionHeartbeat();
        // 清理本地状态
        try { if (typeof userDBDelete === 'function') await userDBDelete(currentUser.phone); } catch(e) {}
        try { if (typeof setToken === 'function') setToken(null); } catch(e) {}
        clearSession();
        currentUser = null;
        alert('您的账号已被删除或禁用（' + (data.message || '请重新登录') + '）');
        if (typeof showLogin === 'function') showLogin();
        else location.reload();
      }
    } catch(e) {
      // 网络不可用，跳过本次检测
    }
  }, 5 * 60 * 1000); // 每5分钟检测一次
}

function stopSessionHeartbeat() {
  if (_sessionHeartbeatTimer) {
    clearInterval(_sessionHeartbeatTimer);
    _sessionHeartbeatTimer = null;
  }
}

// ========== 退出登录 ==========
function doLogout(){
  stopSessionHeartbeat();
  addSysLog('login','用户退出登录');
  clearSession();
  currentUser=null;
  renderUserBar();
  updateNavByRole();
  // 隐藏所有 tab-content
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.setProperty('display', 'none', 'important');
    el.classList.remove('active');
  });
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

  // 优先从云端同步用户数据，直接用云端数据渲染（保证积分等字段最新）
  let users = null;
  if(window.cloudSync && window.cloudSync.getToken && window.cloudSync.getToken()){
    try{
      const cloudUsers = await window.cloudSync.getUsers();
      console.log('[UserManage] 云端用户同步:', cloudUsers.length, '个');
      for(const u of cloudUsers){
        const local = await userDBGet(u.phone);
        if(local && local.password) u.password = local.password;
        await userDBPut(u);
      }
      if(cloudUsers.length > 0) users = cloudUsers;
    }catch(e){
      console.warn('[UserManage] 云端用户同步失败，使用本地数据:', e.message);
    }
  }
  if(!users) users = await userDBGetAll();
  const roles  = await roleDBGetAll();
  const tbody  = document.getElementById('userTableBody');
  if(!tbody) return;
  tbody.innerHTML = users.map(u=>{
    const isSuper = u.role==='super_admin';
    const avatarChar = (u.name||u.phone).charAt(0);
    const roleIcons = {super_admin:'👑',admin:'🛡️',member:'👤'};
    const roleName = (roles.find(r=>r.id===u.role)||{}).name || u.role || 'member';
    // 角色列（超管固定展示，其他用自定义下拉）
    let roleSel = '';
    const wrId = 'rd_u_' + u.phone.replace(/\D/g,'');
    if(isSuper){
      roleSel = '<span style="font-size:12px;color:var(--accent);font-weight:600;">👑 超级管理员 <span style="font-size:11px;color:var(--text3);">(内置)</span></span>';
    }else{
      const selRole = roles.find(r=>r.id===u.role)||{id:'member',name:'普通成员'};
      const filterRoles = roles.filter(r=>r.id!=='super_admin');
      roleSel = '<div class="rd-wrap" id="'+wrId+'" data-value="'+u.role+'" style="min-width:130px;">'+
        '<div class="rd-trigger" onclick="rdToggle(\''+wrId+'\')">'+
          '<span class="rd-label">'+(roleIcons[selRole.id]||'👤')+' '+escHtml(selRole.name)+'</span>'+
          '<span class="rd-arrow">▾</span>'+
        '</div>'+
        '<div class="rd-menu">'+
          filterRoles.map(r=>
            '<div class="rd-item '+(r.id===u.role?'selected':'')+'" data-value="'+r.id+'" '+
            'onclick="rdPick(\''+wrId+'\',this);changeUserRole(\''+u.phone+'\',\''+r.id+'\')">'+
            (roleIcons[r.id]||'👤')+' '+escHtml(r.name)+
            '</div>'
          ).join('')+
        '</div>'+
      '</div>';
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
        (!isSuper?'<button class="btn-sm danger" onclick="window.deleteUser(\''+u.phone+'\')">删除</button>':'<span style="color:var(--text3);font-size:11px;">不可操作</span>')+
      '</div></td>'+
    '</tr>';
  }).join('');
}

async function resetUserPwd(phone){
  const newPwd = prompt(`请输入用户 ${phone} 的新密码（至少6位）：`);
  if(!newPwd||newPwd.length<6){if(newPwd!==null)alert('密码至少6位');return;}
  try{
    const user = await userDBGet(phone);
    if(!user){alert('用户不存在');return;}
    user.password = newPwd;
    await userDBPut(user);
    // 同步到云端：通过 POST /api/users/:id/reset-password 重置密码
    try {
      if (typeof cloudRequest === 'function') {
        const userData = await cloudRequest('/users');
        const list = Array.isArray(userData.data) ? userData.data : ((userData.data && userData.data.list) || []);
        const cloudUser = list.find(u => u.phone === phone);
        if (cloudUser && cloudUser.id) {
          await cloudRequest(`/users/${cloudUser.id}/reset-password`, {
            method: 'POST',
            body: { newPassword: newPwd }
          });
          console.log('[resetUserPwd] 云端重置成功:', phone);
        }
      }
    } catch(syncErr) {
      console.warn('[resetUserPwd] 云端同步失败（本地已更新）:', syncErr.message);
    }
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

    // 同步到云端（超管调整积分）
    try {
      if (typeof cloudUpdateUserPoints === 'function') {
        const operatorPhone = currentUser && currentUser.phone;
        const synced = await cloudUpdateUserPoints(phone, val, { type: 'adjust', description: '超管调整积分', operator_phone: operatorPhone });
        if (synced) {
          console.log('[doAdjustPoints] 云端积分同步成功:', phone, val);
        } else {
          console.warn('[doAdjustPoints] 云端积分同步失败:', phone);
        }
      }
    } catch (cloudErr) {
      console.warn('[doAdjustPoints] 云端同步异常:', cloudErr.message);
      // 不阻塞流程，本地已更新
    }

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

window.deleteUser = async function(phone){
  console.log('[deleteUser] 函数被调用，手机号:', phone);
  console.log('[deleteUser] confirmDialog是否存在:', typeof window.confirmDialog);
  const confirmed = await window.confirmDialog({
    title: '删除用户',
    message: '确定要删除该用户吗？',
    detail: `删除后，手机号 ${phone} 将无法登录系统，且相关数据将被清除。此操作不可撤销。`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消',
    confirmClass: 'danger'
  });
  if(!confirmed) return;

  try{
    let cloudDeleted = false;
    // 先同步到云端：通过 DELETE /api/users/:id 删除
    if (typeof cloudRequest === 'function') {
      try {
        const userData = await cloudRequest('/users');
        const list = Array.isArray(userData.data) ? userData.data : ((userData.data && userData.data.list) || []);
        const cloudUser = list.find(u => u.phone === phone);
        if (cloudUser && cloudUser.id) {
          const delResult = await cloudRequest(`/users/${cloudUser.id}`, { method: 'DELETE' });
          if (delResult.code === 200) {
            console.log('[deleteUser] 云端删除成功:', phone);
            cloudDeleted = true;
          }
        }
      } catch(syncErr) {
        console.warn('[deleteUser] 云端同步失败:', syncErr.message);
        await window.confirmDialog({
          title: '删除失败',
          message: '云端删除失败，请检查网络或稍后重试',
          type: 'danger',
          confirmText: '确定',
          cancelText: '',
          confirmClass: 'confirm'
        });
        return;
      }
    }
    // 再删本地
    await userDBDelete(phone);
    renderUserManage();
    addSysLog('delete', '删除用户: '+phone);
    
    if (cloudDeleted) {
      await window.confirmDialog({
        title: '删除成功',
        message: '用户已成功删除',
        type: 'success',
        confirmText: '确定',
        cancelText: '',
        confirmClass: 'confirm'
      });
    }
  }catch(e){
    await window.confirmDialog({
      title: '删除失败',
      message: '删除失败：' + e.message,
      type: 'danger',
      confirmText: '确定',
      cancelText: '',
      confirmClass: 'confirm'
    });
  }
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
  // 填充角色选择器（自定义下拉）
  try {
    let roles = await roleDBGetAll();
    if(!roles || roles.length === 0){
      roles = [
        {id:'super_admin', name:'超级管理员'},
        {id:'admin',       name:'管理员'},
        {id:'member',      name:'普通成员'},
      ];
    }
    if(typeof rdBuild === 'function') rdBuild('addUserRoleWrap', roles, 'member');
  } catch(e){
    if(typeof rdBuild === 'function') rdBuild('addUserRoleWrap', [{id:'member',name:'普通成员'}], 'member');
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
  const errEl   = document.getElementById('addUserError');
  if(!errEl) return;
  errEl.className = 'msg-err';
  errEl.textContent = '';

  const name    = nameEl  ? nameEl.value.trim()  : '';
  const phone   = phoneEl ? phoneEl.value.trim() : '';
  const pwd     = pwdEl   ? pwdEl.value       : '';
  const roleId  = (typeof rdGetValue === 'function' ? rdGetValue('addUserRoleWrap') : '') || 'member';

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
    // 同步到云端 MySQL + D1
    try {
      if (window.cloudSync && typeof window.cloudSync.createUser === 'function') {
        console.log('[doAddUser] 同步用户到云端:', phone, name||`用户${phone.slice(-4)}`, roleId);
        const cloudResult = await window.cloudSync.createUser(phone, name||`用户${phone.slice(-4)}`, pwd, roleId);
        console.log('[doAddUser] 云端同步结果:', cloudResult);
        if (cloudResult) { user._cloudSynced = true; await userDBPut(user); }
      } else if (typeof cloudRequest === 'function') {
        // 备用：直接通过 API 注册到 MySQL
        console.log('[doAddUser] 通过 cloudRequest 注册到云端');
        const regResult = await cloudRequest('/auth/register', {
          method: 'POST',
          body: { phone, password: pwd, name: name||`用户${phone.slice(-4)}`, role: roleId }
        });
        console.log('[doAddUser] cloudRequest 注册结果:', regResult);
        if (regResult && regResult.code === 200) { user._cloudSynced = true; await userDBPut(user); }
      }
    } catch(cloudErr) {
      console.warn('[doAddUser] 云端同步失败（本地已保存）:', cloudErr);
    }
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
    // 同步到云端：通过 PUT /api/users/:id 更新 role_id
    try {
      if (typeof cloudRequest === 'function') {
        const userData = await cloudRequest('/users');
        const list = Array.isArray(userData.data) ? userData.data : ((userData.data && userData.data.list) || []);
        const cloudUser = list.find(u => u.phone === phone);
        if (cloudUser && cloudUser.phone) {
          await cloudRequest(`/users/${cloudUser.phone}`, {
            method: 'PUT',
            body: { role_id: newRoleId }
          });
          console.log('[changeUserRole] 云端同步成功:', phone, '→', newRoleId);
        }
      }
    } catch(syncErr) {
      console.warn('[changeUserRole] 云端同步失败（本地已更新）:', syncErr.message);
    }
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
        // 验证云端账号是否仍然存在（防止已删账号通过本地会话复活）
        // 用原始 fetch 调 /api/auth/profile，避免 cloudRequest 把 HTTP 错误码当异常处理
        let cloudOk = true; // 默认乐观，网络不通时允许离线
        try{
          const _token = typeof getToken === 'function' ? getToken() : '';
          const _base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : 'https://api.zhenwu.fun/api';
          const profileResp = await fetch(`${_base}/auth/profile`, {
            headers: _token ? { 'Authorization': 'Bearer ' + _token } : {}
          });
          const profileData = await profileResp.json();
          if(profileData && profileData.code === 401){
            cloudOk = false;
            console.warn('[Session] 云端验证不通过，清理本地会话:', session.phone, profileData.message);
          }
        }catch(netErr){
          // 网络不可用，跳过验证允许离线
          console.warn('[Session] 云端验证失败，使用离线模式:', netErr.message);
        }
        if(!cloudOk){
          try{ await userDBDelete(session.phone); }catch(e){}
          clearSession();
          showLogin();
          return;
        }
        currentUser = user;
        // 同步会话中的积分到本地（确保自动登录时积分是最新的）
        if(session.points !== undefined && session.points !== user.points){
          user.points = session.points;
          await userDBPut(user);
        }
        addSysLog('login','自动登录（会话恢复）');
        startSessionHeartbeat();
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



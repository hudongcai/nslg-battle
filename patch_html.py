import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 在 </style> 前注入登录CSS
login_css = """
    /* ===== 登录 ===== */
    #loginOverlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;}
    .login-box{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:32px 28px;width:360px;max-width:92vw;box-shadow:0 8px 40px rgba(0,0,0,.5);}
    .login-title{font-size:20px;font-weight:bold;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-align:center;margin-bottom:4px;}
    .login-sub{font-size:11px;color:var(--text3);text-align:center;margin-bottom:16px;}
    .login-tabs{display:flex;gap:0;margin-bottom:14px;border-bottom:1px solid var(--border);}
    .ltab{flex:1;text-align:center;padding:7px 0;cursor:pointer;font-size:13px;color:var(--text2);border-bottom:2px solid transparent;transition:all .2s;}
    .ltab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:bold;}
    .login-panel{display:none;}.login-panel.active{display:block;}
    .fg{margin-bottom:12px;}.fg label{display:block;font-size:11px;color:var(--text2);margin-bottom:4px;}
    .fg input{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font-size:13px;box-sizing:border-box;}
    .fg input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px rgba(240,180,41,.1);}
    .btn-primary{width:100%;padding:10px;background:linear-gradient(135deg,var(--accent),#e09422);color:#0c0f1a;border:none;border-radius:7px;font-size:14px;font-weight:bold;cursor:pointer;transition:all .2s;}
    .btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px);}
    .btn-sms{padding:9px 0;background:var(--bg3);color:var(--accent);border:1px solid var(--border);border-radius:7px;font-size:12px;cursor:pointer;transition:all .2s;}
    .btn-sms:hover{border-color:var(--accent);}.btn-sms:disabled{opacity:.5;cursor:not-allowed;}
    .switch-link{text-align:center;font-size:11px;color:var(--text3);margin-top:10px;}.switch-link a{color:var(--accent);cursor:pointer;text-decoration:none;margin:0 2px;}
    .switch-link a:hover{text-decoration:underline;}
    .msg-err{color:var(--red);font-size:11px;margin-top:6px;text-align:center;}.msg-suc{color:var(--green);font-size:11px;margin-top:6px;text-align:center;}
    .sms-hint{font-size:10px;color:var(--orange);margin-top:6px;padding:6px 8px;background:rgba(255,146,43,.08);border-radius:5px;}
    /* 用户栏 */#userBar{display:flex;align-items:center;gap:10px;}
    /* 头像 */.avatar-circle{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;color:#fff;}.avatar-circle.super{background:linear-gradient(135deg,#a855f7,#6366f1);}.avatar-circle.normal{background:linear-gradient(135deg,var(--accent),var(--orange));}
    .role-badge{padding:1px 6px;border-radius:3px;font-size:10px;}.role-badge.super{background:rgba(168,85,247,.15);color:var(--purple);}.role-badge.normal{background:rgba(240,180,41,.12);color:var(--accent);}
"""
# 在 </style> 前插入
content = content.replace('</style>', login_css + '\n    </style>', 1)

# 2. 在导航栏末尾（</div> 前，该 div 是 nav）注入新按钮
# 找到 <div class="nav"> ... </div> 中的最后一个 button 后的 </div>
# 精准替换：在 </div>\n  <div class="main"> 前插入新按钮
new_nav_buttons = """
  <button onclick="switchTab('project',this)" style="display:none;" id="navProject">📁 项目管理</button>
  <button onclick="switchTab('user',this)" style="display:none;" id="navUser">👤 用户管理</button>
"""
content = content.replace('\n  </div>\n<div class="main">', '\n' + new_nav_buttons + '  </div>\n<div class="main">', 1)

# 3. 在 </body> 前注入 script 标签和新的 tab 内容
# 先构造项目管理 tab 内容
project_tab = """
  <!-- Tab: 项目管理 -->
  <div id="tab-project" class="tab-content">
    <div class="card" id="projectManageContent" style="padding:16px 12px;"></div>
  </div>
"""

# 用户管理 tab 内容
user_tab = """
  <!-- Tab: 用户管理 -->
  <div id="tab-user" class="tab-content">
    <div class="card" style="padding:16px 12px;">
      <h3>👤 用户管理 <span class="badge">超级管理员专属</span></h3>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">管理所有注册用户，可重置密码或删除用户</div>
      <table style="width:100%;font-size:12px;border-collapse:separate;border-spacing:0;">
        <thead><tr>
          <th style="width:40px;text-align:center;">头像</th>
          <th>昵称</th>
          <th>手机号</th>
          <th>角色</th>
          <th>注册时间</th>
          <th style="width:140px;">操作</th>
        </tr></thead>
        <tbody id="userTableBody"></tbody>
      </table>
    </div>
  </div>
"""

# 注入 script 标签（在 </body> 前）
scripts = '''
<script src="user-system.js"></script>
<script src="project-system.js"></script>
<script>
// 修改后的 init：先检查登录态
async function init(){
  await openDB();
  await checkLoginState();
  document.body.addEventListener('dragover',e=>{if(e.dataTransfer.files.length>0)e.preventDefault();});
  document.body.addEventListener('drop',e=>{if(e.dataTransfer.files.length>0){e.preventDefault();if(document.getElementById('tab-data').classList.contains('active'))handleBatchUpload(e.dataTransfer.files);}});
}
init();

// 修改后的 switchTab 支持新标签页（修复：同时操作 display 和 classList）
const _origSwitchTab = switchTab;
function switchTab(tabId,btn){
  // 强制隐藏所有 tab-content，再显示目标 tab
  document.querySelectorAll('.tab-content').forEach(el=>{
    el.style.display='none';
    el.classList.remove('active');
  });
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  const tabEl = document.getElementById('tab-'+tabId);
  if(tabEl){ tabEl.style.display='block'; tabEl.classList.add('active'); }
  if(btn) btn.classList.add('active');
  // 项目子导航显隐逻辑
  var sn=document.getElementById('projectSubNav');
  var bar=document.getElementById('projectBar');
  var tp=document.getElementById('tab-project');
  if(tabId==='data'||tabId==='winrate'){ if(sn)sn.style.display='flex'; if(bar)bar.style.display='flex'; }
  else if(tabId==='project'){ if(sn)sn.style.display='none'; if(bar)bar.style.display='none'; if(tp)tp.style.display='block'; }
  else { if(sn)sn.style.display='none'; if(bar)bar.style.display='none'; if(tp)tp.style.display='none'; }
  if(tabId==='data'){renderDataTable();renderGallery();}
  if(tabId==='winrate'){updateWinRateFilters();renderWinRateTable();renderEnemyFreq();}
  if(tabId==='library'){renderHeroes();renderTactics();}
  if(tabId==='ranking') renderRanking();
  if(tabId==='peijiang') onPeijiangChange();
  if(tabId==='yanwu') onYanwuChange();
  if(tabId==='project'){if(typeof loadProjects==='function') loadProjects();}
  if(tabId==='user'){if(typeof renderUserManage==='function') renderUserManage();}
  if(tabId==='syslog'){if(typeof renderSysLog==='function') renderSysLog();}
  if(tabId==='rolemanage'){if(typeof renderRoleManage==='function') renderRoleManage();}
}
</script>
'''

content = content.replace('</body>', project_tab + user_tab + scripts + '\n</body>')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('patch 完成')

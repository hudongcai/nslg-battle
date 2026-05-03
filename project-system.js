/* ==========================================================
   PROJECT SYSTEM - 项目管理、权限控制
   ========================================================== */

// ========== 项目数据结构 ==========
// project: {id, name, desc, creator, createAt, visibility, memberPhones:[], battleRecordIds:[]}
// visibility: 'public' | 'private'

// ========== 获取当前用户可见项目 ==========
async function getVisibleProjects(){
  if(!currentUser)return[];
  const all = await projDBGetAll();
  if(currentUser.role==='super_admin') return all;
  return all.filter(p=>
    p.visibility==='public' ||
    p.creator === currentUser.phone ||
    (p.memberPhones||[]).includes(currentUser.phone)
  );
}

// ========== 渲染项目管理页 ==========
async function renderProjectManage(){
  if(!currentUser)return;
  const projects = await getVisibleProjects();
  const canManage = currentUser.role==='super_admin';
  const grid = document.getElementById('projectGrid');
  const empty = document.getElementById('projectEmpty');
  if(!grid)return;

  // 超管可见的"修复战报计数"按钮
  let repairHtml = '';
  if (canManage) {
    repairHtml = `<div style="grid-column:1/-1;margin-bottom:12px;display:flex;justify-content:flex-end;">
      <button onclick="repairBattleRecordIds()" style="padding:6px 16px;border-radius:6px;border:1px solid var(--accent);background:rgba(240,180,41,.08);color:var(--accent);cursor:pointer;font-size:12px;">
        🔧 修复所有项目战报计数
      </button>
    </div>`;
  }
  if(projects.length===0){
    grid.style.display='none';
    if(empty) empty.style.display='block';
    return;
  }
  grid.style.display='grid';
  if(empty) empty.style.display='none';

  // 获取当前用户的 projAccess 权限
  let userPerms = {};
  if(typeof getProjAccessForUser === 'function'){
    try{
      const entries = await getProjAccessForUser(currentUser.phone);
      entries.forEach(e => { userPerms[e.projectId] = e; });
    }catch(e){}
  }

  let html = projects.map(p=>{
    const isOwner = p.creator===currentUser.phone;
    const isPublic = p.visibility==='public';
    const memberCount = (p.memberPhones||[]).length + 1;
    const battleCount  = (p.battleRecordIds||[]).length;
    const dateStr  = p.createdAt?new Date(p.createdAt).toLocaleDateString('zh-CN'):'-';
    const perm = userPerms[p.id] || {};
    const canEdit = isOwner || canManage || perm.canEdit;
    const canDelete = isOwner || canManage || perm.canDelete;
    return `<div class="proj-card" onclick="viewProject('${p.id}')">
      <div class="pc-top">
        <div>
          <div class="pc-name">${escHtml(p.name)}</div>
          <div class="pc-desc">${escHtml(p.desc||'暂无描述')}</div>
        </div>
        <span class="pc-badge" style="background:${isPublic?'rgba(81,207,102,.12);color:var(--green);':'rgba(255,107,107,.1);color:var(--red);'}">${isPublic?'🌐 公开':'🔒 私有'}</span>
      </div>
      <div class="pc-meta">
        <span>👤 ${memberCount} 成员</span>
        <span>📊 ${battleCount} 战报</span>
        <span>📅 ${dateStr}</span>
      </div>
      <div class="pc-actions" onclick="event.stopPropagation();">
        ${canEdit?`<button onclick="editProject('${p.id}')">编辑</button>`:''}
        ${canManage?`<button onclick="manageProjectMembers('${p.id}')">成员</button>`:''}
        ${canDelete?`<button style="color:#ff5252;border-color:rgba(255,82,82,.2);" onclick="deleteProject('${p.id}')">删除</button>`:''}
      </div>
    </div>`;
  }).join('');

  // 「新建项目」色块卡片，始终在最后一位
  html += `<div class="proj-card proj-card--add" onclick="showCreateProject()" title="新建项目"
    style="display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed rgba(240,180,41,.25);background:rgba(240,180,41,.04);min-height:140px;">
    <div style="text-align:center;color:var(--accent);font-size:14px;font-weight:bold;">
      <div style="font-size:36px;line-height:1;margin-bottom:8px;">＋</div>
      <div>新建项目</div>
    </div>
  </div>`;


  grid.innerHTML = repairHtml + html;
}

// ========== 新建/编辑项目弹窗 ==========
async function showCreateProject(projectId){
  const isEdit = !!projectId;
  let proj = null;
  if(isEdit){
    proj = await projDBGet(projectId);
    if(!proj){alert('项目不存在');return;}
  }
  const overlay = document.createElement('div');
  overlay.id = 'projectModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:420px;max-width:90vw;">
      <h3 style="margin:0 0 16px 0;color:var(--accent);">${isEdit?'编辑项目':'新建项目'}</h3>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px;">项目名称 *</label>
        <input id="projName" style="width:100%;" value="${isEdit?escHtml(proj.name):''}" placeholder="输入项目名称">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px;">项目描述</label>
        <textarea id="projDesc" style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:8px;font-size:12px;resize:vertical;">${isEdit?escHtml(proj.desc||''):''}</textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px;">可见性</label>
        <select id="projVisibility" style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);">
          <option value="public" ${isEdit&&proj.visibility==='public'?'selected':''}>🌐 公开 - 所有用户可见</option>
          <option value="private" ${!isEdit?'selected':(isEdit&&proj.visibility==='private'?'selected':'')}>🔒 私有 - 仅成员可见</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeProjectModal()">取消</button>
        <button class="btn btn-primary" onclick="saveProject('${projectId||''}')">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function closeProjectModal(){const el=document.getElementById('projectModal');if(el)el.remove();}

async function saveProject(projectId){
  const name = document.getElementById('projName').value.trim();
  const desc = document.getElementById('projDesc').value.trim();
  const visibility = document.getElementById('projVisibility').value;
  if(!name){alert('请输入项目名称');return;}
  try{
    if(projectId){
      const proj = await projDBGet(projectId);
      if(!proj){alert('项目不存在');return;}
      proj.name = name; proj.desc = desc; proj.visibility = visibility;
      await projDBPut(proj);
    }else{
      const newProj = {
        id: 'proj_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        name, desc, visibility,
        creator: currentUser.phone,
        memberPhones: [],
        battleRecordIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await projDBPut(newProj);
      // 自动给创建者授予编辑和删除权限
      if(typeof permDBPut === 'function'){
        await permDBPut({
          id: currentUser.phone + '_' + newProj.id,
          phone: currentUser.phone,
          projectId: newProj.id,
          canEdit: true,
          canDelete: true,
          grantedBy: currentUser.phone,
          grantedAt: Date.now()
        });
      }
    }
    closeProjectModal();
    renderProjectManage();
    if(typeof addSysLog==='function') addSysLog('action', projectId ? '编辑项目: '+name : '创建项目: '+name);
  }catch(e){alert('保存失败：'+e.message);}
}

function editProject(id){showCreateProject(id);}

// ========== 成员管理 ==========
async function manageProjectMembers(projectId){
  // 只有超管能分配成员
  if(!currentUser || currentUser.role !== 'super_admin'){
    alert('只有超级管理员可以分配项目成员');
    return;
  }
  const proj = await projDBGet(projectId);
  if(!proj){alert('项目不存在');return;}
  const allUsers = await userDBGetAll();
  const members = proj.memberPhones||[];
  let userOpts = allUsers
    .filter(u=>u.phone!==proj.creator)
    .map(u=>`<option value="${u.phone}" ${members.includes(u.phone)?'selected':''}>${escHtml(u.name)} (${u.phone})</option>`)
    .join('');
  const overlay = document.createElement('div');
  overlay.id='memberModal';
  overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML=`
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:400px;max-width:90vw;">
      <h3 style="margin:0 0 16px 0;color:var(--accent);">成员管理 - ${escHtml(proj.name)}</h3>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">选择可访问该项目的用户（Creator自动拥有权限）：</div>
      <select id="memberSelect" multiple style="width:100%;height:180px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:6px;font-size:12px;">
        ${userOpts}
      </select>
      <div style="font-size:10px;color:var(--text3);margin-top:4px;">按住 Ctrl 可多选</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button class="btn btn-secondary" onclick="closeMemberModal()">取消</button>
        <button class="btn btn-primary" onclick="saveMembers('${projectId}')">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function closeMemberModal(){const el=document.getElementById('memberModal');if(el)el.remove();}

async function saveMembers(projectId){
  const sel = document.getElementById('memberSelect');
  const selected = [...sel.selectedOptions].map(o=>o.value);
  try{
    const proj = await projDBGet(projectId);
    if(!proj){alert('项目不存在');return;}
    proj.memberPhones = selected;
    proj.updatedAt = Date.now();
    await projDBPut(proj);
    closeMemberModal();
    renderProjectManage();
  }catch(e){alert('保存失败：'+e.message);}
}

// ========== 查看项目（进入项目详情，显示子导航） ==========
async function viewProject(projectId){
  const proj = await projDBGet(projectId);
  if(!proj){alert('项目不存在');return;}
  window.currentProjectId = projectId;
  // 隐藏项目列表，显示项目子导航
  document.getElementById('tab-project').style.display='none';
  document.getElementById('projectSubNav').style.display='flex';
  // 先加载项目数据（过滤后），再切换 tab 确保显示正确
  if(typeof loadAllRecords==='function') await loadAllRecords();
  // 默认切换到战报导入
  switchTab('data', document.querySelector('#projectSubNav button'));
}

// ========== 退出项目（返回项目列表） ==========
function exitProject(){
  window.currentProjectId = null;
  // 隐藏子导航
  const sn = document.getElementById('projectSubNav');
  if(sn) sn.style.display='none';
  // 用 switchTab 正确切换到项目管理 tab（会自动隐藏其他 tab）
  if(typeof switchTab==='function'){
    switchTab('project', document.getElementById('navProject'));
  } else {
    // fallback：直接操作
    document.querySelectorAll('.tab-content').forEach(t=>{ t.style.display='none'; t.classList.remove('active'); });
    const tabProject = document.getElementById('tab-project');
    if(tabProject){tabProject.style.display='block';tabProject.classList.add('active');}
    if(typeof renderProjectManage==='function') renderProjectManage();
  }
  // 清除数据过滤
  if(typeof loadAllRecords==='function') loadAllRecords();
}

// ========== 删除项目 ==========
async function deleteProject(projectId){
  // 权限检查：超管 / 创建者 / 有 canDelete 权限的用户
  const proj = await projDBGet(projectId);
  if(!proj){alert('项目不存在');return;}
  const isOwner = proj.creator === currentUser.phone;
  const isSuperAdmin = currentUser.role === 'super_admin';
  let canDelete = false;
  if(isSuperAdmin || isOwner) canDelete = true;
  if(!canDelete && typeof canUserDeleteProject === 'function'){
    canDelete = await canUserDeleteProject(currentUser.phone, projectId);
  }
  if(!canDelete){
    alert('您没有删除该项目的权限');
    return;
  }
  if(!confirm('确定删除该项目？项目内的战报不会删除，但关联将解除。'))return;
  try{
    await projDBDelete(projectId);
    renderProjectManage();
    if(typeof addSysLog==='function') addSysLog('delete', '删除项目: '+proj.name);
  }catch(e){alert('删除失败：'+e.message);}
}

// ========== 项目切换器（顶部）==========
async function renderProjectSwitcher(){
  if(!currentUser)return;
  const projects = await getVisibleProjects();
  let switcher = document.getElementById('projectSwitcher');
  if(!switcher){
    switcher = document.createElement('div');
    switcher.id='projectSwitcher';
    switcher.style.cssText='padding:6px 28px;background:var(--bg3);border-bottom:1px solid var(--border);font-size:12px;display:flex;align-items:center;gap:8px;overflow-x:auto;';
    const navEl = document.querySelector('.nav');
    if(navEl) navEl.parentNode.insertBefore(switcher, navEl);
  }
  if(projects.length===0){
    switcher.innerHTML=`<span style="color:var(--text3);">暂无项目，</span><a href="javascript:void(0)" onclick="showProjectHome();" style="color:var(--accent);">去创建</a>`;
  }else{
    let html=`<span style="color:var(--text3);white-space:nowrap;">项目：</span>`;
    html+=`<span style="cursor:pointer;padding:2px 8px;border-radius:4px;${!window.currentProjectId?'background:var(--accent);color:#000;font-weight:bold;':'color:var(--text2);'}" onclick="clearProjectFilter()">全部</span>`;
    projects.forEach(p=>{
      const active = window.currentProjectId===p.id;
      html+=`<span style="cursor:pointer;padding:2px 8px;border-radius:4px;white-space:nowrap;${active?'background:var(--accent);color:#000;font-weight:bold;':'color:var(--text2);'}" onclick="switchToProject('${p.id}')">${escHtml(p.name)}</span>`;
    });
    switcher.innerHTML=html;
  }
  switcher.style.display='flex';
}

async function switchToProject(pid){
  window.currentProjectId = pid;
  renderProjectSwitcher();
  if(typeof loadAllRecords==='function') await loadAllRecords();
  // 如果当前在战报导入 tab，重新渲染
  const tabData = document.getElementById('tab-data');
  if(tabData && tabData.classList.contains('active')){
    if(typeof renderDataTable==='function') renderDataTable();
    if(typeof renderGallery==='function') renderGallery();
  }
}

// ========== 加载项目列表 ==========
async function loadProjects(){
  await renderProjectManage();
}

// ========== 修改原有 loadAllRecords 以支持项目过滤 ==========
// 在原有 index.html 的 loadAllRecords 中，需要加入项目过滤逻辑
// 通过包装原函数来实
function getProjectFilteredIds(){
  if(!window.currentProjectId) return null;
  // 从 projDB 获取项目，返回 battleRecordIds
  return projDBGet(window.currentProjectId).then(p=>p?p.battleRecordIds||[]:null);
}

// ========== 将战报关联到项目 ==========
async function assignRecordToProject(recordId, projectId){
  const proj = await projDBGet(projectId);
  if(!proj) return false;
  if(!proj.battleRecordIds) proj.battleRecordIds = [];
  if(!proj.battleRecordIds.includes(recordId)){
    proj.battleRecordIds.push(recordId);
    await projDBPut(proj);
  }
  return true;
}

// ========== 修复项目 battleRecordIds（同步实际战报数据）==========
async function repairBattleRecordIds() {
  if (!confirm('确定修复所有项目的战报计数？\n\n这会根据实际战报数据重新同步 battleRecordIds。\n\n注意：此操作会覆盖项目中的 battleRecordIds，请确保数据已备份。')) return;
  try {
    const projects = await projDBGetAll();
    const records = await dbGetAll();

    console.log('[repair] 共', projects.length, '个项目，', records.length, '条战报');
    // 调试：打印前3条战报的 projectId 字段
    records.slice(0, 3).forEach((r, i) => {
      console.log(`[repair] 战报${i}: id=${r.id}, projectId=${r.projectId} (type: ${typeof r.projectId})`);
    });

    // 构建 projectId → recordId[] 映射（强制转字符串比较）
    const recordMap = {};
    for (const r of records) {
      if (!r.projectId && r.projectId !== 0) continue;
      const pid = String(r.projectId);
      if (!recordMap[pid]) recordMap[pid] = [];
      recordMap[pid].push(r.id);
    }

    console.log('[repair] recordMap keys:', Object.keys(recordMap));

    let repaired = 0;
    for (const proj of projects) {
      const pid = String(proj.id);
      const actualIds = recordMap[pid] || [];
      const oldIds = proj.battleRecordIds || [];

      console.log(`[repair] 项目 ${proj.name} (id=${pid}): 旧 ${oldIds.length} 条 → 新 ${actualIds.length} 条`);

      // 强制更新
      proj.battleRecordIds = actualIds;
      await projDBPut(proj);
      repaired++;
    }
    alert(`修复完成！共修复 ${repaired} 个项目。\n\n请按 F5 刷新页面查看最新战报数量。`);
  } catch (e) {
    console.error('[repair] 失败:', e);
    alert('修复失败：' + e.message);
  }
}

// ========== 显示项目管理首页 ==========
async function showProjectHome(){
  // 清除项目过滤
  window.currentProjectId = null;
  // 用 switchTab 正确切换到项目管理（会自动隐藏其他 tab 和子导航）
  if(typeof switchTab==='function'){
    switchTab('project', document.getElementById('navProjectBtn'));
  } else {
    // fallback
    document.querySelectorAll('.tab-content').forEach(t=>{ t.style.display='none'; t.classList.remove('active'); });
    const tabProject = document.getElementById('tab-project');
    if(tabProject){tabProject.style.display='block';tabProject.classList.add('active');}
    await renderProjectManage();
  }
}

// ========== 显示系统配置 ==========
async function showSystemConfig(){
  // 先确保子导航按钮按权限刷新
  if(typeof updateNavByRole==='function') await updateNavByRole();
  // 云端服务按钮：仅超管可见
  const cloudBtn = document.getElementById('subCloudService');
  if(cloudBtn) cloudBtn.style.display = (currentUser?.role==='super_admin') ? 'inline-block' : 'none';
  // 确保顶级导航高亮「系统配置」
  document.querySelectorAll('#topNav button').forEach(b=>b.classList.remove('active'));
  const sysBtn = document.getElementById('navSystemBtn');
  if(sysBtn) sysBtn.classList.add('active');
  // 显示系统子导航，切换到第一个可见子菜单
  const ssn = document.getElementById('systemSubNav');
  if(ssn) ssn.style.display='flex';
  const visibleBtns = Array.from(document.querySelectorAll('#systemSubNav button'))
    .filter(b=>b.style.display!=='none');
  if(visibleBtns.length>0){
    const tabName = visibleBtns[0].getAttribute('onclick')
      ?.match(/switchTab\('(\w+)'/)?.[1];
    if(tabName && typeof switchTab==='function'){
      await switchTab(tabName, visibleBtns[0]);
      return;
    }
    visibleBtns[0].click();
  } else {
    alert('当前角色无系统配置的访问权限');
  }
}

// ========== init 里调用 ==========
// 在 onLoginSuccess 里已调用 loadProjects()

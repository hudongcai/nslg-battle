/* ==========================================================
   PROJECT SYSTEM - 项目管理、权限控制
   ========================================================== */
console.log('[project-system.js] v20260619001 加载');

// ========== 项目数据结构 ==========
// project: {id, name, desc, creator, createAt, visibility, memberPhones:[], battleRecordIds:[]}
// visibility: 'public' | 'private'

// ========== 获取当前用户可见项目（云端为真相之源，本地多余项目视为已删除）==========
async function filterVisibleProjectsFromCache(projects){
  if(!currentUser)return[];
  const all = Array.from(projects || []);
  if(currentUser.role==='super_admin') return all;

  // 获取用户的 projAccess 权限
  let grantedIds = new Set();
  if(typeof getGrantedProjectIds === 'function'){
    try{ grantedIds = await getGrantedProjectIds(currentUser.phone); }catch(e){}
  }

  return all.filter(p=>
    p.visibility==='public' || p.is_public == 1 ||
    p.creator === currentUser.phone || p.creator_phone === currentUser.phone ||
    (p.memberPhones||[]).includes(currentUser.phone) ||
    grantedIds.has(p.id) || grantedIds.has(String(p.id))
  );
}

async function getVisibleProjects(options = {}){
  if(!currentUser)return[];

  // 始终先读本地
  const localProjects = await projDBGetAll();
  let merged = new Map();
  for (const p of localProjects) { merged.set(p.id, p); }

  if(options.cacheOnly){
    return await filterVisibleProjectsFromCache(Array.from(merged.values()));
  }

  // 再从云端获取，合并到本地
  // cloudIds = 后端按权限过滤后返回的项目集合，用于前端可见性判断
  let cloudIds = new Set();
  let cloudFetchSuccess = false; // 标记云端是否成功响应
  if(window.cloudSync){
    try{
      const cloudProjects = await window.cloudSync.getProjects();
      console.log('[Cloud] 从云端获取项目:', cloudProjects.length, '个');
      for(const proj of cloudProjects){
        cloudIds.add(String(proj.id));
        await projDBPut(proj); // 同步到本地缓存
        merged.set(proj.id, proj); // 云端始终覆盖本地（云端是真相源）
      }
      cloudFetchSuccess = true;

      // 清理本地有但云端没有的项目（所有用户生效）
      // 注意：不再自动推送本地项目到云端——那会把管理员已删除的项目复活
      // 云端是唯一真相源：不在云端 = 已被删除，直接清理本地缓存
      for(const [id, p] of new Map(merged)){
        if(!cloudIds.has(String(id))){
          console.log('[Cloud] 项目', p.name, '(', id, ') 在云端不存在，从本地清理');
          await projDBDelete(id);
          merged.delete(id);
        }
      }
    }catch(e){
      console.error('[Cloud] 获取云端项目失败，使用本地数据:', e);
    }
  }

  const all = Array.from(merged.values());

  if(currentUser.role==='super_admin') return all;

  // 云端响应成功：以云端权限为唯一依据，防止显示数据库已删除的幽灵项目
  if(cloudFetchSuccess){
    return all.filter(p => cloudIds.has(String(p.id)));
  }

  // 云端响应失败（离线模式）：回退到本地缓存判断
  let grantedIds = new Set();
  if(typeof getGrantedProjectIds === 'function'){
    try{ grantedIds = await getGrantedProjectIds(currentUser.phone); }catch(e){}
  }
  return all.filter(p=>
    p.visibility==='public' || p.is_public == 1 ||
    p.creator === currentUser.phone || p.creator_phone === currentUser.phone ||
    (p.memberPhones||[]).includes(currentUser.phone) ||
    grantedIds.has(p.id)
  );
}

// ========== 项目查询（云端优先，失败回退本地）==========
async function getProjectWithFallback(projectId, options = {}) {
  let proj = null;
  if (options.cacheFirst) {
    proj = await projDBGet(projectId);
    if (proj) return proj;
  }
  // 云端优先（云端是真相源）
  if (typeof window.cloudSync?.getProject === 'function') {
    try {
      proj = await window.cloudSync.getProject(projectId);
      if (proj) {
        await projDBPut(proj);
        console.log('[getProjectWithFallback] 从云端获取项目:', proj.name);
        return proj;
      }
    } catch (e) {
      const errMsg = e.message || String(e);
      console.warn('[getProjectWithFallback] 云端获取失败:', errMsg);
      // 云端明确返回"项目不存在"，说明云端已删除，同步删除本地
      if (errMsg.includes('不存在') || errMsg.includes('Not Found') || errMsg.includes('404')) {
        console.log('[getProjectWithFallback] 云端项目已删除，清理本地:', projectId);
        await projDBDelete(projectId);
      }
    }
  }
  // 云端无数据或失败，回退本地
  proj = await projDBGet(projectId);
  if (proj) {
    console.log('[getProjectWithFallback] 使用本地项目:', proj.name);
  }
  return proj;
}

// ========== 渲染项目管理页 ==========
async function renderProjectManage(options = {}){
  if(!currentUser)return;
  options = { cacheOnly: true, ...options };
  const projects = await getVisibleProjects(options);
  const canManage = currentUser.role==='super_admin';
  const grid = document.getElementById('projectGrid');
  const empty = document.getElementById('projectEmpty');
  if(!grid)return;

  if(projects.length===0){
    grid.style.display='none';
    if(empty) empty.style.display='block';
    return;
  }
  grid.style.display='grid';
  if(empty) empty.style.display='none';

  // 获取当前用户的 projAccess 权限
  let userPerms = {};
  if(!canManage && typeof getProjAccessForUser === 'function'){
    try{
      const entries = await getProjAccessForUser(currentUser.phone);
      entries.forEach(e => { userPerms[e.projectId] = e; });
    }catch(e){}
  }

  let html = projects.map(p=>{
    const isOwner = p.creator===currentUser.phone || p.creator_phone===currentUser.phone;
    // 兼容云端字段：is_public=1 或 visibility='public'
    const isPublic = p.visibility==='public' || p.is_public==1;
    // member_count/battle_count 优先用云端实时计算值，回退本地统计
    const memberCount = p.member_count !== undefined ? p.member_count : (p.memberCount !== undefined ? p.memberCount : (p.memberPhones||[]).length + 1);
    const battleCount = p.battle_count !== undefined ? p.battle_count : (p.battleCount !== undefined ? p.battleCount : (p.battleRecordIds||[]).length);
    // 时间：优先 created_at（云端），回退 createdAt（本地）
    const dateRaw = p.created_at || p.createdAt;
    const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString('zh-CN') : '-';
    const perm = userPerms[p.id] || {};
    const canEdit = isOwner || canManage || perm.canEdit;
    const canDelete = isOwner || canManage || perm.canDelete;
    // 成员管理权：超管 或 被超管授权了 canMember
    const canMember = canManage || perm.canMember;
    return `<div class="proj-card" onclick="viewProject('${p.id}')">
      <div class="pc-top">
        <div>
          <div class="pc-name">${escHtml(p.name)}</div>
          <div class="pc-desc">${escHtml(p.desc||p.description||'暂无描述')}</div>
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
        ${canMember?`<button onclick="manageProjectMembers('${p.id}')">成员</button>`:''}
        ${canManage?`<button onclick="managePlayerDict('${p.id}')">玩家字典</button>`:''}
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


  grid.innerHTML = html;
}

// ========== 新建/编辑项目弹窗 ==========
async function showCreateProject(projectId){
  const isEdit = !!projectId;
  let proj = null;
  if(isEdit){
    // 修复：使用 getProjectWithFallback，本地找不到时尝试从云端获取
    proj = await getProjectWithFallback(projectId);
    if(!proj){alert('项目不存在');return;}
  }
  // 计算有效可见性：优先 visibility 字段，兜底用 is_public（云端返回原始数据时 visibility 可能为 undefined）
  const projVis = isEdit
    ? (proj.visibility || (proj.is_public == 1 ? 'public' : 'private'))
    : 'private';

  // 同盟名：最多3个，从 JSON 数组读取
  const leftAl  = isEdit ? (Array.isArray(proj.left_alliances)  ? proj.left_alliances  : []) : [];
  const rightAl = isEdit ? (Array.isArray(proj.right_alliances) ? proj.right_alliances : []) : [];
  const alInput = (vals, prefix) => [0,1,2].map(i =>
    `<input id="${prefix}${i}" style="width:100%;margin-bottom:4px;" value="${escHtml(vals[i]||'')}" placeholder="同盟${i+1}（选填）">`
  ).join('');

  const inputStyle = 'width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);box-sizing:border-box;';

  const overlay = document.createElement('div');
  overlay.id = 'projectModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:480px;max-width:94vw;max-height:90vh;overflow-y:auto;">
      <h3 style="margin:0 0 16px 0;color:var(--accent);">${isEdit?'编辑项目':'新建项目'}</h3>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px;">项目名称 *</label>
        <input id="projName" style="${inputStyle}" value="${isEdit?escHtml(proj.name):''}" placeholder="输入项目名称">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px;">项目描述</label>
        <textarea id="projDesc" style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:8px;font-size:12px;resize:vertical;box-sizing:border-box;">${isEdit?escHtml(proj.desc||proj.description||''):''}</textarea>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:4px;">可见性</label>
        <select id="projVisibility" style="${inputStyle}">
          <option value="public" ${projVis==='public'?'selected':''}>🌐 公开 - 所有用户可见</option>
          <option value="private" ${projVis==='private'?'selected':''}>🔒 私有 - 仅成员可见</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:6px;">左方同盟（最多3个）</label>
          ${alInput(leftAl, 'projLeftAl')}
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--text2);margin-bottom:6px;">右方同盟（最多3个）</label>
          ${alInput(rightAl, 'projRightAl')}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeProjectModal()">取消</button>
        <button class="btn btn-primary" onclick="saveProject('${projectId||''}')">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function closeProjectModal(){const el=document.getElementById('projectModal');if(el)el.remove();}

function _readAllianceInputs(prefix){
  return [0,1,2].map(i=>(document.getElementById(prefix+i)||{}).value||'').map(s=>s.trim()).filter(Boolean);
}

async function saveProject(projectId){
  const name = document.getElementById('projName').value.trim();
  const desc = document.getElementById('projDesc').value.trim();
  const visibility = document.getElementById('projVisibility').value;
  const left_alliances  = _readAllianceInputs('projLeftAl');
  const right_alliances = _readAllianceInputs('projRightAl');
  if(!name){alert('请输入项目名称');return;}
  try{
    let proj;
    if(projectId){
      // 编辑现有项目
      proj = await getProjectWithFallback(projectId);
      if(!proj){alert('项目不存在');return;}
      Object.assign(proj, { name, desc, visibility, left_alliances, right_alliances, updatedAt: Date.now() });
      await projDBPut(proj);

      if(window.cloudSync){
        try{
          await window.cloudSync.updateProject(projectId, { name, description: desc, visibility, left_alliances, right_alliances });
        }catch(e){console.error('[Cloud] 同步失败:', e);}
      }
    }else{
      // 创建新项目：先调云端获取真实 ID，再存本地
      const newProj = {
        name, desc, visibility, left_alliances, right_alliances,
        creator: currentUser.phone,
        creator_phone: currentUser.phone,
        memberPhones: [],
        battleRecordIds: [],
        members: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      if(window.cloudSync){
        try{
          const result = await window.cloudSync.createProject(newProj);
          if(result && result.id) newProj.id = result.id;
        }catch(e){console.error('[Cloud] 同步失败:', e);}
      }

      if(!newProj.id) newProj.id = 'tmp_' + Date.now();

      await projDBPut(newProj);

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

// ========== 玩家字典管理 ==========
async function managePlayerDict(projectId){
  const token = window.cloudSync ? window.cloudSync.getToken() : (localStorage.getItem('nslg_token') || '');
  const authHeaders = { 'Content-Type':'application/json', Authorization: 'Bearer '+token };
  const BASE = window.cloudSync ? window.cloudSync.BASE_URL||'' : '';

  const modal = document.createElement('div');
  modal.id = 'playerDictModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:600px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;color:var(--accent);">玩家字典</h3>
        <button class="btn btn-secondary" onclick="document.getElementById('playerDictModal').remove()">关闭</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
        <select id="pdSide" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);">
          <option value="left">左方</option>
          <option value="right">右方</option>
          <option value="unknown">未知</option>
        </select>
        <label class="btn btn-secondary" style="cursor:pointer;margin:0;">
          导入 Excel
          <input type="file" id="pdExcelFile" accept=".xlsx,.xls,.csv" style="display:none;" onchange="importPlayerDictExcel('${projectId}')">
        </label>
        <span id="pdImportMsg" style="font-size:12px;color:var(--text2);"></span>
        <a href="#" onclick="downloadPlayerDictTemplate();return false;" style="font-size:12px;color:var(--accent);">下载模板</a>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">
        Excel 第一列填玩家名即可（无需表头）；也支持带表头格式：player_name | alliance_name | side
      </div>
      <div style="flex:1;overflow-y:auto;" id="pdTableWrap">加载中...</div>
    </div>`;
  document.body.appendChild(modal);

  async function reload(){
    const wrap = document.getElementById('pdTableWrap');
    if(!wrap) return;
    try{
      const r = await fetch(`${BASE}/api/projects/${projectId}/player-dict`, { headers: authHeaders });
      const d = await r.json();
      const rows = d.data || [];
      if(!rows.length){ wrap.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center;">暂无玩家</div>'; return; }
      const sideLabel = {left:'左方',right:'右方',unknown:'未知'};
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="color:var(--text2);border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:6px 8px;">玩家名</th>
          <th style="text-align:left;padding:6px 8px;">联盟</th>
          <th style="text-align:left;padding:6px 8px;">阵营</th>
          <th style="padding:6px 8px;"></th>
        </tr></thead>
        <tbody>${rows.map(r=>`<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
          <td style="padding:6px 8px;">${escHtml(r.player_name)}</td>
          <td style="padding:6px 8px;color:var(--text2);">${escHtml(r.alliance_name||'')}</td>
          <td style="padding:6px 8px;color:var(--text2);">${sideLabel[r.side]||r.side}</td>
          <td style="padding:6px 8px;text-align:right;">
            <button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" onclick="deletePlayerDictEntry('${projectId}',${r.id})">删</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>`;
    }catch(e){ if(wrap) wrap.innerHTML = '<div style="color:#f55;">加载失败: '+e.message+'</div>'; }
  }

  window._pdReload = reload;
  window._pdProjectId = projectId;
  reload();
}

async function deletePlayerDictEntry(projectId, entryId){
  if(!confirm('确认删除？'))return;
  const token = window.cloudSync ? window.cloudSync.getToken() : (localStorage.getItem('nslg_token') || '');
  const BASE = window.cloudSync ? window.cloudSync.BASE_URL||'' : '';
  await fetch(`${BASE}/api/projects/${projectId}/player-dict/${entryId}`, {
    method:'DELETE', headers:{ Authorization:'Bearer '+token }
  });
  if(window._pdReload) window._pdReload();
}

async function importPlayerDictExcel(projectId){
  const fileInput = document.getElementById('pdExcelFile');
  const msgEl = document.getElementById('pdImportMsg');
  const side = document.getElementById('pdSide').value;
  if(!fileInput.files.length) return;
  const file = fileInput.files[0];
  msgEl.textContent = '上传中...';
  const token = window.cloudSync ? window.cloudSync.getToken() : (localStorage.getItem('nslg_token') || '');
  const BASE = window.cloudSync ? window.cloudSync.BASE_URL||'' : '';
  try{
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const r = await fetch(`${BASE}/api/projects/${projectId}/player-dict/import`, {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:'Bearer '+token},
      body: JSON.stringify({ fileBase64: b64, side })
    });
    const d = await r.json();
    if(d.code===200){
      msgEl.textContent = `导入成功：${d.data.added} 条，跳过 ${d.data.skipped} 条`;
      fileInput.value = '';
      if(window._pdReload) window._pdReload();
    } else {
      msgEl.textContent = '导入失败: '+(d.message||'未知错误');
    }
  }catch(e){ msgEl.textContent = '错误: '+e.message; }
}

function downloadPlayerDictTemplate(){
  const XLSX2 = window.XLSX;
  if(!XLSX2){ alert('XLSX 库未加载，请手动创建 Excel 文件\n列：player_name | alliance_name | side'); return; }
  const ws = XLSX2.utils.aoa_to_sheet([
    ['player_name','alliance_name','side'],
    ['蔷薇|云初月','天下无双','left'],
    ['玩家B','','right'],
  ]);
  const wb = XLSX2.utils.book_new();
  XLSX2.utils.book_append_sheet(wb, ws, '玩家字典');
  XLSX2.writeFile(wb, '玩家字典模板.xlsx');
}

// ========== 成员管理 ==========
async function manageProjectMembers(projectId){
  if(!currentUser){ return; }
  const isAdmin = currentUser.role === 'super_admin';
  if (!isAdmin) {
    let hasMemberPerm = false;
    if (typeof getProjAccessForUser === 'function') {
      try {
        const entries = await getProjAccessForUser(currentUser.phone);
        const perm = entries.find(e => String(e.projectId) === String(projectId));
        hasMemberPerm = !!(perm && perm.canMember);
      } catch(e) {}
    }
    if (!hasMemberPerm) { alert('没有成员管理权限，请联系超级管理员授权'); return; }
  }
  // 先显示加载占位
  const overlay = document.createElement('div');
  overlay.id='memberModal';
  overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:32px;color:var(--text2);font-size:14px;">⏳ 加载成员信息…</div>`;
  document.body.appendChild(overlay);
  try{
    const proj = await getProjectWithFallback(projectId);
    if(!proj){ overlay.remove(); alert('项目不存在'); return; }
    const allUsers = await userDBGetAll();
    let cloudMembers = [];
    if(window.cloudSync){ try{ cloudMembers = await window.cloudSync.getProjectMembers(projectId)||[]; }catch(e){} }
    const memberPhones = new Set(cloudMembers.map(m=>m.phone));
    _mmBuild(overlay, projectId, proj, allUsers, memberPhones);
  }catch(e){ overlay.remove(); alert('加载失败：'+e.message); }
}

// 渲染单个用户行（供列表复用）
function _mmRow(u, memberPhones){
  const ok = memberPhones.has(u.phone);
  return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;cursor:pointer;margin-bottom:3px;border:1px solid ${ok?'rgba(240,180,41,.35)':'var(--border)'};background:${ok?'rgba(240,180,41,.05)':'transparent'};transition:border .15s,background .15s;user-select:none;">
    <input type="checkbox" value="${escHtml(u.phone)}" ${ok?'checked':''} style="width:15px;height:15px;accent-color:var(--accent);flex-shrink:0;cursor:pointer;" onchange="_mmToggle(this)">
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(u.name)}</div>
      <div style="font-size:11px;color:var(--text2);">${u.phone}</div>
    </div>
    ${ok?'<span style="font-size:10px;color:var(--accent);background:rgba(240,180,41,.15);padding:1px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0;">已加入</span>':''}
  </label>`;
}

function _mmBuild(overlay, projectId, proj, allUsers, memberPhones){
  const creatorPhone = proj.creator_phone || proj.creator || '';
  window._mm = { projectId, proj, allUsers, memberPhones: new Set(memberPhones), origPhones: new Set(memberPhones), creatorPhone };
  const creatorUser = allUsers.find(u=>u.phone===creatorPhone);
  const others = allUsers.filter(u=>u.phone!==creatorPhone);

  overlay.innerHTML=`
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);width:440px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <div style="font-size:15px;font-weight:600;color:var(--accent);">👥 成员管理</div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px;">${escHtml(proj.name)}</div>
    </div>
    <div style="padding:10px 20px 6px;flex-shrink:0;">
      <input id="mm-kw" placeholder="🔍 搜索姓名 / 手机号…" oninput="_mmRefresh(this.value)"
        style="width:100%;box-sizing:border-box;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;">
    </div>
    <div style="padding:4px 20px 6px;flex-shrink:0;">
      <div style="font-size:11px;color:var(--text3);margin-bottom:5px;">创建者（始终拥有权限）</div>
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:rgba(255,255,255,.03);">
        <span style="font-size:16px;flex-shrink:0;">👑</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;color:var(--text);">${escHtml(creatorUser?.name||'未知用户')}</div>
          <div style="font-size:11px;color:var(--text2);">${creatorPhone}</div>
        </div>
        <span style="font-size:10px;color:var(--accent);background:rgba(240,180,41,.15);padding:1px 7px;border-radius:10px;flex-shrink:0;">创建者</span>
      </div>
    </div>
    <div style="padding:2px 20px 4px;flex-shrink:0;"><div style="font-size:11px;color:var(--text3);">其他成员</div></div>
    <div id="mm-list" style="flex:1;overflow-y:auto;padding:2px 20px 8px;">
      ${others.length ? others.map(u=>_mmRow(u,memberPhones)).join('') : '<div style="text-align:center;color:var(--text3);padding:24px 0;font-size:13px;">暂无其他用户</div>'}
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
      <div style="font-size:12px;color:var(--text2);">已选 <b id="mm-cnt">${memberPhones.size}</b> 名成员（不含创建者）</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" onclick="closeMemberModal()">取消</button>
        <button class="btn btn-primary" id="mm-btn" onclick="_mmSave()">保存</button>
      </div>
    </div>
  </div>`;
}

function _mmRefresh(kw){
  const {allUsers, creatorPhone, memberPhones} = window._mm;
  const k = (kw||'').toLowerCase();
  const users = allUsers.filter(u=>{
    if(u.phone===creatorPhone) return false;
    if(!k) return true;
    return u.name.toLowerCase().includes(k) || u.phone.includes(k);
  });
  const list = document.getElementById('mm-list');
  if(list) list.innerHTML = users.length
    ? users.map(u=>_mmRow(u,memberPhones)).join('')
    : '<div style="text-align:center;color:var(--text3);padding:24px 0;font-size:13px;">暂无匹配用户</div>';
}

function _mmToggle(cb){
  const {memberPhones} = window._mm;
  if(cb.checked) memberPhones.add(cb.value); else memberPhones.delete(cb.value);
  const row = cb.closest('label');
  if(row){
    row.style.border = cb.checked ? '1px solid rgba(240,180,41,.35)' : '1px solid var(--border)';
    row.style.background = cb.checked ? 'rgba(240,180,41,.05)' : 'transparent';
    let badge = row.querySelector('span:last-of-type');
    if(cb.checked && (!badge || badge.textContent!=='已加入')){
      const s = document.createElement('span');
      s.style.cssText='font-size:10px;color:var(--accent);background:rgba(240,180,41,.15);padding:1px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0;';
      s.textContent='已加入';
      row.appendChild(s);
    } else if(!cb.checked && badge && badge.textContent==='已加入'){
      badge.remove();
    }
  }
  const cnt = document.getElementById('mm-cnt');
  if(cnt) cnt.textContent = memberPhones.size;
}

async function _mmSave(){
  const {projectId, memberPhones, origPhones} = window._mm;
  const btn = document.getElementById('mm-btn');
  if(btn){ btn.disabled=true; btn.textContent='保存中…'; }
  try{
    const newPhones = [...memberPhones];
    const proj = await projDBGet(projectId);
    if(proj){ proj.memberPhones=newPhones; proj.updatedAt=Date.now(); await projDBPut(proj); }
    if(window.cloudSync){
      const toAdd = newPhones.filter(p=>!origPhones.has(p));
      const toRemove = [...origPhones].filter(p=>!memberPhones.has(p));
      for(const phone of toAdd){
        await window.cloudSync.addProjectMember(projectId, phone, 'viewer');
        // 自动写入 canView 权限到本地 permDB（成员自动拥有可见权限）
        if(typeof permDBPut === 'function'){
          await permDBPut({ id: phone+'_'+projectId, phone, projectId, grantedBy: currentUser.phone, grantedAt: Date.now(), canView: true, canEdit: false, canDelete: false, canMember: false });
        }
      }
      for(const phone of toRemove){
        await window.cloudSync.removeProjectMember(projectId, phone);
        // 移除成员时清除 canView 权限（如无其他权限则删除整条记录）
        if(typeof permDBDelete === 'function'){
          await permDBDelete(phone+'_'+projectId);
        }
      }
      if(typeof clearPermCache === 'function') clearPermCache();
    }
    closeMemberModal();
    renderProjectManage();
  }catch(e){
    if(btn){ btn.disabled=false; btn.textContent='保存'; }
    alert('保存失败：'+e.message);
  }
}

function closeMemberModal(){ const el=document.getElementById('memberModal'); if(el) el.remove(); delete window._mm; }

// ========== 查看项目（进入项目详情，显示子导航） ==========
async function viewProject(projectId){
  const proj = await getProjectWithFallback(projectId, { cacheFirst: true });
  if(!proj){ alert('项目不存在'); return; }
  window.currentProjectId = projectId;
  window.currentProjectName = proj.name || '';
  // 标记当前用户是否为项目所有者（创建者或超管），供图库等模块判断
  const _isOwner = proj.creator === currentUser.phone || proj.creator_phone === currentUser.phone;
  const _isSuperAdmin = currentUser && currentUser.role === 'super_admin';
  window.currentProjectIsOwner = _isOwner || _isSuperAdmin;
  // 隐藏项目列表，显示项目子导航
  document.getElementById('tab-project').style.display='none';
  // 更新项目子导航，添加项目名称显示
  const projectSubNav = document.getElementById('projectSubNav');
  if(projectSubNav){
    // 保存原始 HTML（如果还没保存）
    if(!window._originalProjectSubNavHTML){
      window._originalProjectSubNavHTML = projectSubNav.innerHTML;
    }
    // 重新构建子导航：左侧项目信息，中间按钮居中，右侧对称留白
    const visLabel = (proj.visibility==='public'||proj.is_public==1) ? '公开' : '私有';
    projectSubNav.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
        <button onclick="exitProject()" style="background:transparent;color:var(--text2);border:none;font-size:13px;padding:4px 10px;border-radius:6px;cursor:pointer;transition:all .2s;flex-shrink:0;" onmouseover="this.style.color='var(--accent)';this.style.background='rgba(240,180,41,.06)'" onmouseout="this.style.color='var(--text2)';this.style.background='transparent'" title="返回项目列表">← 返回</button>
        <span style="font-size:14px;font-weight:600;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;" title="${escHtml(proj.name)}">${escHtml(proj.name)}</span>
        <span style="font-size:10px;color:var(--text2);background:rgba(240,180,41,.08);padding:1px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;">${escHtml(visLabel)}</span>
      </div>
      <div style="display:flex;gap:16px;flex-shrink:0;">
        <button onclick="switchTab('data',this)" style="min-width:200px;padding:10px 32px;border-radius:8px;border:2px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:14px;font-weight:bold;transition:all .25s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text2)'">📥 战报导入</button>
        <button onclick="switchTab('winrate',this)" style="min-width:200px;padding:10px 32px;border-radius:8px;border:2px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:14px;font-weight:bold;transition:all .25s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text2)'">⚔️ 克制分析</button>
      </div>
      <div style="flex:1;min-width:0;"></div>
    `;
    projectSubNav.style.display='flex';
  }
  // 先加载本地缓存并打开页面，云端全量同步放到后台刷新
  // 性能优化：显示加载提示，异步加载数据
  const loadingPromise = (async () => {
    if(typeof loadAllRecords==='function') await loadAllRecords();
  })();

  // 默认切换到战报导入
  await switchTab('data', document.querySelector('#projectSubNav button[onclick*="switchTab\(\'data\'"]'));

  // 等待数据加载完成后再渲染
  await loadingPromise;

  if(window.cloudSync && typeof window.cloudSync.syncProjectRecords === 'function'){
    (async () => {
      try {
        await window.cloudSync.syncProjectRecords(projectId);
        if(String(window.currentProjectId) !== String(projectId)) return;
        if(typeof loadAllRecords==='function') await loadAllRecords();
        if(typeof renderDataTable==='function') renderDataTable();
        if(typeof renderGallery==='function') renderGallery();
      } catch(e) {
        console.warn('[viewProject] background sync failed:', e);
      }
    })();
  }
  // 🔥 优化：禁用自动批量图片同步，改为按需加载（点击"查看原图"时才加载）
  // 原因：批量同步会将所有战报图片下载到 IndexedDB，导致缓存爆炸（1000条战报 ≈ 0.5-2GB）
  // 解决方案：showRecordImage() 已实现云端按需加载，用户体验无损，缓存占用降低 100-1000 倍
  /*
  if(window.currentProjectIsOwner && window.cloudSync && typeof window.cloudSync.syncProjectImages === 'function'){
    setTimeout(() => window.cloudSync.syncProjectImages(projectId), 500);
  }
  */
}

// ========== 退出项目（返回项目列表） ==========
function exitProject(){
  window.currentProjectId = null;
  window.currentProjectIsOwner = null;
  if(typeof stopOcrWatchPolling === 'function') stopOcrWatchPolling();
  // 隐藏子导航
  const sn = document.getElementById('projectSubNav');
  if(sn){
    // 恢复原始 HTML
    if(window._originalProjectSubNavHTML){
      sn.innerHTML = window._originalProjectSubNavHTML;
    }
    sn.style.display='none';
  }
  // 用 switchTab 正确切换到项目管理 tab（会自动隐藏其他 tab）
  if(typeof switchTab==='function'){
    switchTab('project', document.getElementById('navProjectBtn'));
  } else {
    // fallback：直接操作
    document.querySelectorAll('.tab-content').forEach(t=>{ t.style.display='none'; t.classList.remove('active'); });
    const tabProject = document.getElementById('tab-project');
    if(tabProject){tabProject.style.display='block';tabProject.classList.add('active');}
    if(typeof renderProjectManage==='function') renderProjectManage();
  }
  // 项目目录不需要加载战报数据，进入具体项目时再读取。
}

// ========== 删除项目 ==========
async function deleteProject(projectId){
  // 权限检查：超管 / 创建者 / 有 canDelete 权限的用户
  const proj = await getProjectWithFallback(projectId);
  if(!proj){alert('项目不存在');return;}
  const isOwner = proj.creator === currentUser.phone || proj.creator_phone === currentUser.phone;
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
  if(!confirm(`确认删除项目「${proj.name}」？\n此操作不可恢复，该项目下所有战报也将一并删除。`)) return;
  try{
    // 先从云端删除
    if(window.cloudSync){
      try{
        await window.cloudSync.deleteProject(projectId);
        console.log('[Cloud] 项目已从云端删除:', proj.name);
      }catch(e){
        console.error('[Cloud] 云端删除失败:', e);
        if(!confirm('云端删除失败，是否仅删除本地记录？')) return;
      }
    }
    // 再从本地删除
    await projDBDelete(projectId);
    if(typeof addSysLog==='function') addSysLog('delete', '删除项目: '+proj.name);
    await renderProjectManage();
  }catch(e){alert('删除失败：'+e.message);}
}

// ========== 项目切换器（顶部）==========
async function renderProjectSwitcher(){
  if(!currentUser)return;
  let switcher = document.getElementById('projectSwitcher');
  if(!switcher){
    switcher = document.createElement('div');
    switcher.id='projectSwitcher';
    switcher.style.cssText='padding:6px 28px;background:var(--bg3);border-bottom:1px solid var(--border);font-size:12px;display:flex;align-items:center;gap:8px;overflow-x:auto;';
    const navEl = document.querySelector('.nav');
    if(navEl) navEl.parentNode.insertBefore(switcher, navEl);
  }
  switcher.style.display='none';
}
// ========== 加载项目列表 ==========
async function loadProjects(){
  await renderProjectManage();
}

// ========== 将战报关联到项目（OCR 自动绑定用）==========
async function addBattleToProject(projectId, recordId){
  const proj = await projDBGet(projectId);
  if(!proj) return false;
  if(!proj.battleRecordIds) proj.battleRecordIds = [];
  if(!proj.battleRecordIds.includes(recordId)){
    proj.battleRecordIds.push(recordId);
    await projDBPut(proj);
  }
  return true;
}
window.addBattleToProject = addBattleToProject;

// ========== 显示项目管理首页 ==========
async function showProjectHome(){
  // 清除项目过滤
  window.currentProjectId = null;
  // 用 switchTab 正确切换到项目管理（会自动隐藏其他 tab 和子导航）
  if(typeof switchTab==='function'){
    await switchTab('project', document.getElementById('navProjectBtn'));
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

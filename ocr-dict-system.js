// ========== OCR 字段库管理系统 ==========
// 武将字段库 / 战法字段库 / 待审核战法

let _currentDictType = 'hero'; // 'hero' | 'tactic'
let _pendingCurrentStatus = 'pending';

function _dictBase() {
  return typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
}

// ── 字段库 Tab 切换 ──────────────────────────────────────────────
function switchDictTab(type) {
  _currentDictType = type;
  const isHero = type === 'hero';
  const heroBtn = document.getElementById('dictTabHero');
  const tacBtn = document.getElementById('dictTabTactic');
  if (heroBtn) {
    heroBtn.style.background = isHero ? 'var(--accent)' : 'transparent';
    heroBtn.style.color = isHero ? '#000' : 'var(--text2)';
    heroBtn.style.border = isHero ? '1px solid var(--accent)' : '1px solid var(--border)';
  }
  if (tacBtn) {
    tacBtn.style.background = !isHero ? 'var(--accent)' : 'transparent';
    tacBtn.style.color = !isHero ? '#000' : 'var(--text2)';
    tacBtn.style.border = !isHero ? '1px solid var(--accent)' : '1px solid var(--border)';
  }
  document.getElementById('dictSearchInput').value = '';
  loadDictList();
}

// ── 加载列表 ─────────────────────────────────────────────────────
async function loadDictList() {
  const q = (document.getElementById('dictSearchInput')?.value || '').trim();
  const type = _currentDictType === 'hero' ? 'heroes' : 'tactics';
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const url = `${_dictBase()}/ocr-dict/${type}` + (q ? '?q=' + encodeURIComponent(q) : '');
    const resp = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const data = await resp.json();
    if (data.code !== 200) throw new Error(data.message);
    renderDictList(data.data || []);
  } catch (e) {
    console.error('[DictList]', e);
  }
}

function renderDictList(rows) {
  const tbody = document.getElementById('dictListBody');
  const total = document.getElementById('dictTotal');
  if (!tbody) return;
  if (total) total.textContent = `共 ${rows.length} 条`;
  tbody.innerHTML = rows.map(r => `
    <tr style="border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <td style="padding:7px 4px;">
        <span id="dict-name-${r.id}">${escHtml(r.name)}</span>
        <input id="dict-input-${r.id}" type="text" value="${escHtml(r.name)}"
          style="display:none;padding:3px 8px;border-radius:4px;border:1px solid var(--accent);background:var(--bg2);color:var(--text1);width:120px;"
          onkeydown="if(event.key==='Enter')saveDictEntry(${r.id});if(event.key==='Escape')cancelDictEdit(${r.id})">
      </td>
      <td style="padding:7px 4px;color:var(--text3);">${(r.created_at || '').slice(0, 10)}</td>
      <td style="padding:7px 4px;text-align:center;">
        <span id="dict-actions-${r.id}">
          <button onclick="editDictEntry(${r.id})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;">编辑</button>
          <button onclick="deleteDictEntry(${r.id},'${escHtml(r.name)}')" style="padding:2px 8px;border-radius:4px;border:1px solid var(--red,#e74c3c);background:transparent;color:var(--red,#e74c3c);cursor:pointer;font-size:12px;margin-left:4px;">删除</button>
        </span>
        <span id="dict-save-${r.id}" style="display:none;">
          <button onclick="saveDictEntry(${r.id})" style="padding:2px 8px;border-radius:4px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:12px;">保存</button>
          <button onclick="cancelDictEdit(${r.id})" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;margin-left:4px;">取消</button>
        </span>
      </td>
    </tr>
  `).join('');
}

// ── 编辑 / 保存 / 取消 ──────────────────────────────────────────
function editDictEntry(id) {
  document.getElementById('dict-name-' + id).style.display = 'none';
  document.getElementById('dict-input-' + id).style.display = 'inline';
  document.getElementById('dict-actions-' + id).style.display = 'none';
  document.getElementById('dict-save-' + id).style.display = 'inline';
  document.getElementById('dict-input-' + id).focus();
}

function cancelDictEdit(id) {
  document.getElementById('dict-name-' + id).style.display = '';
  document.getElementById('dict-input-' + id).style.display = 'none';
  document.getElementById('dict-actions-' + id).style.display = '';
  document.getElementById('dict-save-' + id).style.display = 'none';
}

async function saveDictEntry(id) {
  const input = document.getElementById('dict-input-' + id);
  const name = (input?.value || '').trim();
  if (!name) return alert('名称不能为空');
  const type = _currentDictType === 'hero' ? 'heroes' : 'tactics';
  const token = typeof getToken === 'function' ? getToken() : '';
  const resp = await fetch(`${_dictBase()}/ocr-dict/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ name }),
  });
  const data = await resp.json();
  if (data.code === 200) {
    loadDictList();
  } else {
    alert(data.message || '保存失败');
  }
}

// ── 新增 ─────────────────────────────────────────────────────────
async function addDictEntry() {
  const input = document.getElementById('dictNewName');
  const name = (input?.value || '').trim();
  if (!name) return alert('请输入名称');
  const type = _currentDictType === 'hero' ? 'heroes' : 'tactics';
  const token = typeof getToken === 'function' ? getToken() : '';
  const resp = await fetch(`${_dictBase()}/ocr-dict/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ name }),
  });
  const data = await resp.json();
  if (data.code === 200) {
    input.value = '';
    loadDictList();
  } else {
    alert(data.message || '新增失败');
  }
}

// ── 删除 ─────────────────────────────────────────────────────────
async function deleteDictEntry(id, name) {
  if (!confirm(`确认删除「${name}」？此操作不可恢复。`)) return;
  const type = _currentDictType === 'hero' ? 'heroes' : 'tactics';
  const token = typeof getToken === 'function' ? getToken() : '';
  const resp = await fetch(`${_dictBase()}/ocr-dict/${type}/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const data = await resp.json();
  if (data.code === 200) loadDictList();
  else alert(data.message || '删除失败');
}

// ── 批量导入 ─────────────────────────────────────────────────────
function showDictBatchImport() {
  const area = document.getElementById('dictBatchArea');
  if (area) { area.style.display = area.style.display === 'none' ? '' : 'none'; }
}

async function submitDictBatch() {
  const text = (document.getElementById('dictBatchText')?.value || '').trim();
  if (!text) return alert('请粘贴名称列表');
  const names = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (names.length === 0) return alert('未解析到有效名称');
  const type = _currentDictType === 'hero' ? 'heroes' : 'tactics';
  const token = typeof getToken === 'function' ? getToken() : '';
  const resp = await fetch(`${_dictBase()}/ocr-dict/${type}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ names }),
  });
  const data = await resp.json();
  alert(data.message || (data.code === 200 ? '导入完成' : '导入失败'));
  if (data.code === 200) {
    document.getElementById('dictBatchText').value = '';
    document.getElementById('dictBatchArea').style.display = 'none';
    loadDictList();
  }
}

// ── 待审核战法 ────────────────────────────────────────────────────
async function loadPendingTactics(status) {
  _pendingCurrentStatus = status || 'pending';
  ['pending', 'approved', 'rejected'].forEach(s => {
    const btn = document.getElementById('pendingFilter' + s.charAt(0).toUpperCase() + s.slice(1));
    if (!btn) return;
    const active = s === _pendingCurrentStatus;
    btn.style.background = active ? 'var(--accent)' : 'transparent';
    btn.style.color = active ? '#000' : 'var(--text2)';
    btn.style.border = active ? '1px solid var(--accent)' : '1px solid var(--border)';
  });

  const token = typeof getToken === 'function' ? getToken() : '';
  try {
    const resp = await fetch(`${_dictBase()}/ocr-dict/tactics/pending?status=${_pendingCurrentStatus}`, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const data = await resp.json();
    if (data.code !== 200) throw new Error(data.message);
    renderPendingList(data.data || []);
  } catch (e) {
    console.error('[PendingTactics]', e);
  }
}

function renderPendingList(rows) {
  const tbody = document.getElementById('pendingListBody');
  const empty = document.getElementById('pendingEmpty');
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  tbody.innerHTML = rows.map(r => {
    const isPending = r.status === 'pending';
    const battleLink = r.source_battle_id
      ? `<span style="color:var(--text3);font-size:12px;">#${r.source_battle_id} ${escHtml((r.attacker_name || '') + ' vs ' + (r.enemy_name || ''))}</span>`
      : '<span style="color:var(--text3);">—</span>';
    const actions = isPending ? `
      <button onclick="approvePendingTactic(${r.id},'${escHtml(r.raw_text)}')" style="padding:3px 10px;border-radius:4px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:12px;">确认入库</button>
      <button onclick="rejectPendingTactic(${r.id})" style="padding:3px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;margin-left:4px;">驳回</button>
    ` : `<span style="color:var(--text3);font-size:12px;">${r.status === 'approved' ? '已通过' : '已驳回'}</span>`;
    return `
      <tr style="border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
        <td style="padding:8px 4px;font-weight:bold;color:var(--text1);">${escHtml(r.raw_text)}</td>
        <td style="padding:8px 4px;color:var(--accent);">${r.detect_count} 次</td>
        <td style="padding:8px 4px;">${battleLink}</td>
        <td style="padding:8px 4px;color:var(--text3);font-size:12px;">${(r.created_at || '').slice(0, 16)}</td>
        <td style="padding:8px 4px;text-align:center;">${actions}</td>
      </tr>
    `;
  }).join('');
}

async function approvePendingTactic(id, name) {
  if (!confirm(`确认将「${name}」加入战法字段库并回填来源战报？`)) return;
  const token = typeof getToken === 'function' ? getToken() : '';
  const resp = await fetch(`${_dictBase()}/ocr-dict/tactics/pending/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  const data = await resp.json();
  alert(data.message || (data.code === 200 ? '已确认入库' : '操作失败'));
  if (data.code === 200) loadPendingTactics(_pendingCurrentStatus);
}

async function rejectPendingTactic(id) {
  if (!confirm('确认驳回此条？')) return;
  const token = typeof getToken === 'function' ? getToken() : '';
  const resp = await fetch(`${_dictBase()}/ocr-dict/tactics/pending/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  const data = await resp.json();
  if (data.code === 200) loadPendingTactics(_pendingCurrentStatus);
  else alert(data.message || '操作失败');
}

// ── Tab 切换时自动加载 ────────────────────────────────────────────

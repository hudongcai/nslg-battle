// ========== OCR 区域编辑器（可视化拖拽框选 + 测试识别）==========
// 仅超管可见，调试阶段使用

// ── 43 个字段区域定义 ────────────────────────────────────────────────
const LE_BOX_DEFS = [
  // 胜负
  { cat: 'winner',      key: 'center', label: '胜负',      color: '#ff6b6b' },
  // 玩家名
  { cat: 'playerNames', key: 'left',   label: '我方玩家名',  color: '#ffd93d' },
  { cat: 'playerNames', key: 'right',  label: '敌方玩家名',  color: '#ffd93d' },
  // 同盟名
  { cat: 'alliances',   key: 'left',   label: '我方同盟名',  color: '#6bcb77' },
  { cat: 'alliances',   key: 'right',  label: '敌方同盟名',  color: '#6bcb77' },
  // 阵型
  { cat: 'formations',  key: 'left',   label: '我方阵型',    color: '#c77dff' },
  { cat: 'formations',  key: 'right',  label: '敌方阵型',    color: '#c77dff' },
  // 武将名 (左3 + 右3)
  { cat: 'heroNames',   key: 'L1',     label: '我方武将1',   color: '#4d96ff' },
  { cat: 'heroNames',   key: 'L2',     label: '我方武将2',   color: '#4d96ff' },
  { cat: 'heroNames',   key: 'L3',     label: '我方武将3',   color: '#4d96ff' },
  { cat: 'heroNames',   key: 'R1',     label: '敌方武将1',   color: '#ff8c42' },
  { cat: 'heroNames',   key: 'R2',     label: '敌方武将2',   color: '#ff8c42' },
  { cat: 'heroNames',   key: 'R3',     label: '敌方武将3',   color: '#ff8c42' },
  // 豆豆 (6)
  { cat: 'stars',       key: 'L1',     label: '我方豆豆1',   color: '#ffd93d' },
  { cat: 'stars',       key: 'L2',     label: '我方豆豆2',   color: '#ffd93d' },
  { cat: 'stars',       key: 'L3',     label: '我方豆豆3',   color: '#ffd93d' },
  { cat: 'stars',       key: 'R1',     label: '敌方豆豆1',   color: '#ffb347' },
  { cat: 'stars',       key: 'R2',     label: '敌方豆豆2',   color: '#ffb347' },
  { cat: 'stars',       key: 'R3',     label: '敌方豆豆3',   color: '#ffb347' },
  // 战损
  { cat: 'damages',     key: 'left',   label: '我方战损',    color: '#e63946' },
  { cat: 'damages',     key: 'right',  label: '敌方战损',    color: '#e63946' },
  // 兵力
  { cat: 'troops',      key: 'left',   label: '我方兵力',    color: '#e07a5f' },
  { cat: 'troops',      key: 'right',  label: '敌方兵力',    color: '#e07a5f' },
  // 战法 左 (9: L1_1 L1_2 L1_3 L2_1 L2_2 L2_3 L3_1 L3_2 L3_3)
  ...['L1','L2','L3'].flatMap(h => [1,2,3].map(s => ({
    cat: 'tactics', key: `${h}_${s}`, label: `我方${h}战法${s}`, color: '#06d6a0',
  }))),
  // 战法 右 (9)
  ...['R1','R2','R3'].flatMap(h => [1,2,3].map(s => ({
    cat: 'tactics', key: `${h}_${s}`, label: `敌方${h}战法${s}`, color: '#15a378',
  }))),
];

// 默认相对坐标（首次没有配置时使用）
// 布局假设：顶部玩家/同盟名 → 中间武将行 → 底部战损兵力
const LE_DEFAULTS = {
  winner:      { center: [0.43, 0.01, 0.57, 0.09] },
  playerNames: { left:   [0.01, 0.01, 0.42, 0.09],  right: [0.58, 0.01, 0.99, 0.09] },
  alliances:   { left:   [0.01, 0.09, 0.42, 0.17],  right: [0.58, 0.09, 0.99, 0.17] },
  formations:  { left:   [0.01, 0.17, 0.15, 0.25],  right: [0.85, 0.17, 0.99, 0.25] },
  heroNames:   {
    L1: [0.01, 0.36, 0.14, 0.48], L2: [0.16, 0.36, 0.29, 0.48], L3: [0.31, 0.36, 0.44, 0.48],
    R1: [0.56, 0.36, 0.69, 0.48], R2: [0.71, 0.36, 0.84, 0.48], R3: [0.86, 0.36, 0.99, 0.48],
  },
  stars: {
    L1: [0.01, 0.27, 0.14, 0.36], L2: [0.16, 0.27, 0.29, 0.36], L3: [0.31, 0.27, 0.44, 0.36],
    R1: [0.56, 0.27, 0.69, 0.36], R2: [0.71, 0.27, 0.84, 0.36], R3: [0.86, 0.27, 0.99, 0.36],
  },
  damages: { left: [0.01, 0.88, 0.44, 0.96], right: [0.56, 0.88, 0.99, 0.96] },
  troops:  { left: [0.01, 0.78, 0.44, 0.88], right: [0.56, 0.78, 0.99, 0.88] },
  tactics: {
    // 左侧：3武将 × 3战法，战法在武将下方
    L1_1: [0.01, 0.48, 0.14, 0.56], L1_2: [0.01, 0.57, 0.14, 0.65], L1_3: [0.01, 0.65, 0.14, 0.73],
    L2_1: [0.16, 0.48, 0.29, 0.56], L2_2: [0.16, 0.57, 0.29, 0.65], L2_3: [0.16, 0.65, 0.29, 0.73],
    L3_1: [0.31, 0.48, 0.44, 0.56], L3_2: [0.31, 0.57, 0.44, 0.65], L3_3: [0.31, 0.65, 0.44, 0.73],
    // 右侧
    R1_1: [0.56, 0.48, 0.69, 0.56], R1_2: [0.56, 0.57, 0.69, 0.65], R1_3: [0.56, 0.65, 0.69, 0.73],
    R2_1: [0.71, 0.48, 0.84, 0.56], R2_2: [0.71, 0.57, 0.84, 0.65], R2_3: [0.71, 0.65, 0.84, 0.73],
    R3_1: [0.86, 0.48, 0.99, 0.56], R3_2: [0.86, 0.57, 0.99, 0.65], R3_3: [0.86, 0.65, 0.99, 0.73],
  },
};

// ── 编辑器状态 ────────────────────────────────────────────────────────
let _leImg = null;          // HTMLImageElement
let _leImgW = 0, _leImgH = 0;
let _leScale = 1;           // canvas 宽/图像宽
let _leProjectId = 0;
let _leBoxes = [];          // [{def, rx1, ry1, rx2, ry2}, ...] 与 LE_BOX_DEFS 一一对应
let _leSelIdx = -1;         // 当前选中 box 下标
let _leDrag = null;         // {mode:'move'|'nw'|'ne'|'sw'|'se', sx, sy, origBox}
let _leCurrentImageB64 = ''; // 上传的图片 base64（供测试用）
let _leImageToken = '';      // Python 侧缓存 token，避免重复传图
let _leBoxesFromRealSource = false; // boxes 是否来自方案/DB（而非默认值）

// ── 初始化 ───────────────────────────────────────────────────────────
async function onLabelEditorTabShow() {
  _initBoxes();
  _renderBoxList();
  await _loadProjectList();
  await _renderSchemeSelect();
  leInitProjectRefSelect();
  // 自动加载 DB 中当前项目/全局的配置到画布，保证显示与实际生效一致
  await _loadConfig(_leProjectId);
  if (!_leBoxesFromRealSource) _setStatus('⚠️ 数据库无配置，当前显示默认坐标，请绑定方案后生效');
}

function _initBoxes() {
  if (_leBoxes.length === LE_BOX_DEFS.length) return; // 已初始化
  _leBoxes = LE_BOX_DEFS.map(def => {
    const d = (LE_DEFAULTS[def.cat] || {})[def.key] || [0.1, 0.1, 0.3, 0.2];
    return { def, rx1: d[0], ry1: d[1], rx2: d[2], ry2: d[3] };
  });
}

async function _loadProjectList() {
  const sel = document.getElementById('leProjectSel');
  if (!sel) return;
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const phone = typeof getCurrentUserPhone === 'function' ? getCurrentUserPhone() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const url = base + '/projects' + (phone ? '?phone=' + encodeURIComponent(phone) : '');
    const resp = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const data = await resp.json();
    if (data.code === 200 && data.data) {
      // 清空旧选项，保留全局
      sel.innerHTML = '<option value="0">全局配置（所有项目通用）</option>';
      (data.data || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || `项目${p.id}`;
        sel.appendChild(opt);
      });
    }
  } catch (e) { /* 无项目列表也可正常使用全局配置 */ }
}

async function leOnProjectChange() {
  const sel = document.getElementById('leProjectSel');
  _leProjectId = parseInt(sel?.value || '0');
  // 如果已经有图片，重新加载该项目的配置并重绘
  if (_leImg) {
    await _loadConfig(_leProjectId);
    _renderCanvas();
  }
}

// ── 上传参考图 ────────────────────────────────────────────────────────
function leUploadRef() {
  document.getElementById('leFileInput')?.click();
}

function leOnFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    _leCurrentImageB64 = e.target.result;  // data:image/...;base64,...
    _leImageToken = '';  // 重置缓存 token
    const img = new Image();
    img.onload = async () => {
      _leImg = img;
      _leImgW = img.naturalWidth;
      _leImgH = img.naturalHeight;
      _initBoxes();
      if (!_leBoxesFromRealSource) {
        // 优先加载当前选中方案的坐标，其次从 DB 加载
        const schemeSel = document.getElementById('leSchemeSelect');
        const selectedScheme = schemeSel?.value;
        if (selectedScheme) {
          const scheme = _getSchemeData(selectedScheme);
          if (scheme?.boxes) {
            _leBoxes = LE_BOX_DEFS.map((def, i) => {
              const coords = scheme.boxes[i];
              if (coords) return { def, rx1: coords.rx1, ry1: coords.ry1, rx2: coords.rx2, ry2: coords.ry2 };
              const d = (LE_DEFAULTS[def.cat] || {})[def.key] || [0.1, 0.1, 0.3, 0.2];
              return { def, rx1: d[0], ry1: d[1], rx2: d[2], ry2: d[3] };
            });
            _leBoxesFromRealSource = true;
          }
        } else {
          await _loadConfig(_leProjectId);
        }
      }
      _showEditorWrap();
      _resizeCanvas();
      _renderCanvas();
      _setStatus(`已加载图片 ${_leImgW}×${_leImgH}，正在预缓存到识别服务...`);
      // 预上传图片到 Python，后续测试无需重复传输
      _leCacheImage();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function _showEditorWrap() {
  const wrap = document.getElementById('leEditorWrap');
  const noImg = document.getElementById('leNoImg');
  if (wrap) wrap.style.display = 'flex';
  if (noImg) noImg.style.display = 'none';
  _bindCanvasEvents();
}

function _resizeCanvas() {
  const canvas = document.getElementById('leCanvas');
  if (!canvas || !_leImg) return;
  const maxW = canvas.parentElement?.clientWidth || 700;
  _leScale = Math.min(1, maxW / _leImgW);
  canvas.width  = Math.round(_leImgW * _leScale);
  canvas.height = Math.round(_leImgH * _leScale);
}

// ── 加载已有配置 ──────────────────────────────────────────────────────
async function _loadConfig(projectId) {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(`${base}/label-config/${projectId}`, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const data = await resp.json();
    if (data.code === 200 && data.data?.categories) {
      _applyCategories(data.data.categories);
      _setStatus(`已加载${data.data.isGlobal ? '全局' : '项目'}配置`);
    }
  } catch (e) { /* 无配置则使用默认值 */ }
}

function _applyCategories(cats) {
  _leBoxes.forEach((b, i) => {
    const catBoxes = cats[b.def.cat]?.boxes || [];
    const found = catBoxes.find(cb => cb.key === b.def.key);
    if (found) {
      b.rx1 = found.rx1; b.ry1 = found.ry1;
      b.rx2 = found.rx2; b.ry2 = found.ry2;
    }
  });
  _leBoxesFromRealSource = true;
}

// ── 保存配置（保存当前画布框坐标到方案 数据库）────────────────
async function leSaveConfig() {
  const sel = document.getElementById('leSchemeSelect');
  let name = sel?.value;
  if (!name) {
    name = prompt('请输入方案名称（如：方案一）：', '方案一');
    if (!name?.trim()) return;
    name = name.trim();
  }
  const schemeData = {
    imageB64: _leCurrentImageB64 || '',   // 保存当前图片
    imageW: _leImgW,
    imageH: _leImgH,
    boxes: _leBoxes.map(b => ({ rx1: b.rx1, ry1: b.ry1, rx2: b.rx2, ry2: b.ry2 })),
    testAllianceSlots: _getTestAllianceSlots(),
    testPlayerNames: _leTestPlayerNames.slice(),
  };
  try {
    _setStatus('⏳ 保存中...');
    await _saveSchemeData(name, schemeData);
    await _renderSchemeSelect();
    if (sel) sel.value = name;
    _setStatus(`✅ 方案"${name}"已保存到云端`);
  } catch (e) {
    _setStatus('❌ 保存失败: ' + e.message);
  }
}

// ── 新建方案 ──────────────────────────────────────────────────────────
async function leNewScheme() {
  const name = prompt('请输入新方案名称（如：方案一）：', '');
  if (!name?.trim()) return;
  const trimmedName = name.trim();
  const names = await _getSchemeNames();
  if (names.includes(trimmedName)) {
    _setStatus(`方案"${trimmedName}"已存在，请在下拉框中选择`);
    const sel = document.getElementById('leSchemeSelect');
    if (sel) sel.value = trimmedName;
    return;
  }
  const schemeData = {
    imageB64: _leCurrentImageB64 || '',   // 保存当前图片
    imageW: _leImgW,
    imageH: _leImgH,
    boxes: _leBoxes.map(b => ({ rx1: b.rx1, ry1: b.ry1, rx2: b.rx2, ry2: b.ry2 })),
    testAllianceSlots: _getTestAllianceSlots(),
    testPlayerNames: _leTestPlayerNames.slice(),
  };
  try {
    _setStatus('⏳ 创建中...');
    await _saveSchemeData(trimmedName, schemeData);
    await _renderSchemeSelect();
    const sel = document.getElementById('leSchemeSelect');
    if (sel) sel.value = trimmedName;
    _setStatus(`✅ 已创建方案"${trimmedName}"`);
  } catch (e) {
    _setStatus('❌ 保存失败: ' + e.message);
  }
}

// ── 绑定生效（将选中方案的坐标写入指定项目/全局的 label_config DB）──
async function leBindScheme() {
  const projectSel = document.getElementById('leProjectSel');
  const bindSchemeSel = document.getElementById('leBindSchemeSelect');
  const schemeName = bindSchemeSel?.value;
  const projectId = parseInt(projectSel?.value || '0');

  if (!schemeName) { _setBindStatus('❌ 请先选择方案'); return; }

  _setBindStatus('⏳ 加载方案数据...');
  const scheme = await _getSchemeData(schemeName);
  if (!scheme?.boxes) { _setBindStatus(`❌ 方案"${schemeName}"数据不存在`); return; }

  const categories = {};
  LE_BOX_DEFS.forEach((def, i) => {
    const coords = scheme.boxes[i];
    if (!coords) return;
    if (!categories[def.cat]) categories[def.cat] = { boxes: [] };
    categories[def.cat].boxes.push({
      key: def.key,
      rx1: +coords.rx1.toFixed(4), ry1: +coords.ry1.toFixed(4),
      rx2: +coords.rx2.toFixed(4), ry2: +coords.ry2.toFixed(4),
    });
  });

  _setBindStatus('⏳ 绑定中...');
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(base + '/label-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({
        projectId: projectId || undefined,
        global: projectId === 0,
        imageWidth: scheme.imageW || 0,
        imageHeight: scheme.imageH || 0,
        categories,
      }),
    });
    const data = await resp.json();
    const scopeLabel = projectId === 0
      ? '全局配置'
      : (projectSel.options[projectSel.selectedIndex]?.text || `项目${projectId}`);
    if (data.code === 200) {
      _setBindStatus(`✅ 已将"${schemeName}"绑定到${scopeLabel}`);
      if (typeof invalidateLabelConfigCache === 'function') invalidateLabelConfigCache();
    } else {
      _setBindStatus('❌ ' + (data.message || '绑定失败'));
    }
  } catch (e) {
    _setBindStatus('❌ ' + e.message);
  }
}

function _setBindStatus(msg) {
  const el = document.getElementById('leBindStatus');
  if (el) el.textContent = msg;
}

function _buildCategories() {
  const cats = {};
  _leBoxes.forEach(b => {
    if (!cats[b.def.cat]) cats[b.def.cat] = { boxes: [] };
    cats[b.def.cat].boxes.push({
      key: b.def.key,
      rx1: +b.rx1.toFixed(4), ry1: +b.ry1.toFixed(4),
      rx2: +b.rx2.toFixed(4), ry2: +b.ry2.toFixed(4),
    });
  });
  return cats;
}

// ── Canvas 渲染 ────────────────────────────────────────────────────────
function _renderCanvas() {
  const canvas = document.getElementById('leCanvas');
  if (!canvas || !_leImg) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(_leImg, 0, 0, W, H);

  _leBoxes.forEach((b, i) => {
    const cx1 = b.rx1 * W, cy1 = b.ry1 * H;
    const cx2 = b.rx2 * W, cy2 = b.ry2 * H;
    const w = cx2 - cx1, h = cy2 - cy1;
    const isSel = i === _leSelIdx;

    ctx.save();
    ctx.strokeStyle = b.def.color;
    ctx.lineWidth = isSel ? 1.5 : 1;
    ctx.globalAlpha = isSel ? 1 : 0.75;
    ctx.strokeRect(cx1, cy1, w, h);
    ctx.fillStyle = b.def.color;
    ctx.globalAlpha = isSel ? 0.18 : 0.08;
    ctx.fillRect(cx1, cy1, w, h);

    // 标签
    ctx.globalAlpha = isSel ? 1 : 0.85;
    ctx.font = `${isSel ? 'bold ' : ''}10px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    const label = b.def.label;
    const tw = ctx.measureText(label).width;
    const tx = Math.min(cx1 + 2, W - tw - 2);
    const ty = Math.max(cy1 + 11, 12);
    ctx.fillText(label, tx, ty);
    ctx.shadowBlur = 0;

    // 选中时画 4 个角把手
    if (isSel) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.def.color;
      const hs = 5;
      [[cx1, cy1], [cx2, cy1], [cx1, cy2], [cx2, cy2]].forEach(([hx, hy]) => {
        ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
      });
    }
    ctx.restore();
  });
}

// ── 鼠标事件 ──────────────────────────────────────────────────────────
let _leEventsBound = false;
function _bindCanvasEvents() {
  if (_leEventsBound) return;
  _leEventsBound = true;
  const canvas = document.getElementById('leCanvas');
  if (!canvas) return;
  canvas.addEventListener('mousedown', _leMouseDown);
  canvas.addEventListener('mousemove', _leMouseMove);
  canvas.addEventListener('mouseup',   _leMouseUp);
  canvas.addEventListener('mouseleave', _leMouseUp);
}

function _canvasPos(e) {
  const canvas = document.getElementById('leCanvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

function _hitHandle(box, px, py, W, H) {
  const cx1 = box.rx1 * W, cy1 = box.ry1 * H;
  const cx2 = box.rx2 * W, cy2 = box.ry2 * H;
  const hs = 8;
  const corners = { nw: [cx1, cy1], ne: [cx2, cy1], sw: [cx1, cy2], se: [cx2, cy2] };
  for (const [dir, [hx, hy]] of Object.entries(corners)) {
    if (Math.abs(px - hx) <= hs && Math.abs(py - hy) <= hs) return dir;
  }
  return null;
}

function _leMouseDown(e) {
  if (!_leImg) return;
  const { x, y } = _canvasPos(e);
  const canvas = document.getElementById('leCanvas');
  const W = canvas.width, H = canvas.height;

  // 先检查当前选中框的角把手
  if (_leSelIdx >= 0) {
    const dir = _hitHandle(_leBoxes[_leSelIdx], x, y, W, H);
    if (dir) {
      const b = _leBoxes[_leSelIdx];
      _leDrag = { mode: dir, sx: x, sy: y, origBox: { ...b } };
      return;
    }
  }

  // 按从后往前顺序（顶层优先）找 hit 的 box
  for (let i = _leBoxes.length - 1; i >= 0; i--) {
    const b = _leBoxes[i];
    const cx1 = b.rx1 * W, cy1 = b.ry1 * H;
    const cx2 = b.rx2 * W, cy2 = b.ry2 * H;
    if (x >= cx1 && x <= cx2 && y >= cy1 && y <= cy2) {
      _leSelIdx = i;
      _leDrag = { mode: 'move', sx: x, sy: y, origBox: { ...b } };
      _updateSelPanel();
      _renderCanvas();
      _renderBoxList();
      return;
    }
  }

  // 点击空白 → 取消选中
  _leSelIdx = -1;
  _leDrag = null;
  _updateSelPanel();
  _renderCanvas();
  _renderBoxList();
}

function _leMouseMove(e) {
  if (!_leDrag || !_leImg) return;
  const { x, y } = _canvasPos(e);
  const canvas = document.getElementById('leCanvas');
  const W = canvas.width, H = canvas.height;
  const dx = (x - _leDrag.sx) / W;
  const dy = (y - _leDrag.sy) / H;
  const ob = _leDrag.origBox;
  const b = _leBoxes[_leSelIdx];

  if (_leDrag.mode === 'move') {
    const bw = ob.rx2 - ob.rx1, bh = ob.ry2 - ob.ry1;
    b.rx1 = Math.max(0, Math.min(1 - bw, ob.rx1 + dx));
    b.ry1 = Math.max(0, Math.min(1 - bh, ob.ry1 + dy));
    b.rx2 = b.rx1 + bw;
    b.ry2 = b.ry1 + bh;
  } else {
    const MIN = 0.01;
    if (_leDrag.mode === 'nw') {
      b.rx1 = Math.max(0, Math.min(ob.rx2 - MIN, ob.rx1 + dx));
      b.ry1 = Math.max(0, Math.min(ob.ry2 - MIN, ob.ry1 + dy));
    } else if (_leDrag.mode === 'ne') {
      b.rx2 = Math.min(1, Math.max(ob.rx1 + MIN, ob.rx2 + dx));
      b.ry1 = Math.max(0, Math.min(ob.ry2 - MIN, ob.ry1 + dy));
    } else if (_leDrag.mode === 'sw') {
      b.rx1 = Math.max(0, Math.min(ob.rx2 - MIN, ob.rx1 + dx));
      b.ry2 = Math.min(1, Math.max(ob.ry1 + MIN, ob.ry2 + dy));
    } else if (_leDrag.mode === 'se') {
      b.rx2 = Math.min(1, Math.max(ob.rx1 + MIN, ob.rx2 + dx));
      b.ry2 = Math.min(1, Math.max(ob.ry1 + MIN, ob.ry2 + dy));
    }
  }

  _renderCanvas();
  _updateSelPanel();
}

function _leMouseUp() {
  _leDrag = null;
}

// ── 右侧面板 ──────────────────────────────────────────────────────────
function _updateSelPanel() {
  const panel = document.getElementById('leSelectedBox');
  if (!panel) return;
  if (_leSelIdx < 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const b = _leBoxes[_leSelIdx];
  const lbl = document.getElementById('leSelLabel');
  if (lbl) lbl.textContent = b.def.label;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v.toFixed(3); };
  set('leInRx1', b.rx1); set('leInRy1', b.ry1);
  set('leInRx2', b.rx2); set('leInRy2', b.ry2);
}

function leUpdateFromInputs() {
  if (_leSelIdx < 0) return;
  const b = _leBoxes[_leSelIdx];
  const get = (id) => parseFloat(document.getElementById(id)?.value || 0);
  let rx1 = get('leInRx1'), ry1 = get('leInRy1');
  let rx2 = get('leInRx2'), ry2 = get('leInRy2');
  // 保证 rx1<rx2, ry1<ry2
  if (rx1 > rx2) [rx1, rx2] = [rx2, rx1];
  if (ry1 > ry2) [ry1, ry2] = [ry2, ry1];
  b.rx1 = Math.max(0, Math.min(1, rx1));
  b.ry1 = Math.max(0, Math.min(1, ry1));
  b.rx2 = Math.max(0, Math.min(1, rx2));
  b.ry2 = Math.max(0, Math.min(1, ry2));
  _renderCanvas();
}

// 左侧图层列表
function _renderBoxList() {
  const list = document.getElementById('leBoxList');
  if (!list) return;
  list.innerHTML = _leBoxes.map((b, i) => {
    const isSel = i === _leSelIdx;
    return `<div onclick="leSelectBox(${i})" style="
      padding:4px 8px;border-radius:4px;cursor:pointer;margin-bottom:1px;
      background:${isSel ? 'rgba(255,255,255,0.1)' : 'transparent'};
      border-left:3px solid ${b.def.color};
      color:${isSel ? 'var(--text1)' : 'var(--text3)'};
      font-size:11px;
    ">${b.def.label}</div>`;
  }).join('');
}

function leSelectBox(i) {
  _leSelIdx = i;
  _updateSelPanel();
  _renderCanvas();
  _renderBoxList();
  // 滚动到该项
  const list = document.getElementById('leBoxList');
  const item = list?.children[i];
  if (item) item.scrollIntoView({ block: 'nearest' });
}

function _setStatus(msg) {
  const el = document.getElementById('leStatus');
  if (el) el.textContent = msg;
}

// ── 图片预缓存 ────────────────────────────────────────────────────────
async function _leCacheImage() {
  try {
    const authToken = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(base + '/ocr-preview/cache-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}) },
      body: JSON.stringify({ imageBase64: _leCurrentImageB64 }),
    });
    const data = await resp.json();
    if (data.code === 200 && data.token) {
      _leImageToken = data.token;
      _setStatus(`图片已缓存 (token: ${data.token})，测试无需重复传输`);
    }
  } catch (e) {
    _setStatus('图片缓存失败，测试时将完整传输');
  }
}

const _LE_ALLIANCE_SLOTS = ['left1','left2','left3','right1','right2','right3'];
let _leTestPlayerNames = [];

function _updatePlayerCount() {
  const el = document.getElementById('lePLPlayerCount');
  if (el) el.textContent = `${_leTestPlayerNames.length} 个`;
}

function _getTestAllianceSlots() {
  return _LE_ALLIANCE_SLOTS.map(k => ({
    key: k,
    allianceName: (document.getElementById(`lePL_${k}_alliance`)?.value || '').trim(),
  }));
}

function _setTestAllianceSlots(list) {
  (list || []).forEach(item => {
    const aEl = document.getElementById(`lePL_${item.key}_alliance`);
    if (aEl) aEl.value = item.allianceName || '';
  });
}

function _clearTestAllianceSlots() {
  _LE_ALLIANCE_SLOTS.forEach(k => {
    const aEl = document.getElementById(`lePL_${k}_alliance`);
    if (aEl) aEl.value = '';
  });
}

function leImportPlayerNames() {
  const current = _leTestPlayerNames.join('\n');
  const text = prompt(
    '批量导入玩家名单（每行一个玩家名，粘贴后确认）：',
    current
  );
  if (text === null) return;
  _leTestPlayerNames = text.split('\n').map(s => s.trim()).filter(Boolean);
  _updatePlayerCount();
}

function leClearPlayerNames() {
  _leTestPlayerNames = [];
  _updatePlayerCount();
}

async function leInitProjectRefSelect() {
  const sel = document.getElementById('lePLProjectRef');
  if (!sel || !window.cloudSync) return;
  try {
    const projs = await window.cloudSync.getProjects();
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- 选择项目 --</option>' +
      projs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (e) { /* 无网络时忽略 */ }
}

async function leRefFromProject() {
  const sel = document.getElementById('lePLProjectRef');
  const msgEl = document.getElementById('lePLRefMsg');
  const projectId = sel?.value;
  if (!projectId) { if (msgEl) msgEl.textContent = '请先选择项目'; return; }
  if (msgEl) msgEl.textContent = '加载中…';
  try {
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const token = typeof getToken === 'function' ? getToken() : '';
    const headers = { Authorization: 'Bearer ' + token };

    // 取项目同盟名
    const projData = await window.cloudSync.getProject(projectId);
    const leftAl = Array.isArray(projData?.left_alliances) ? projData.left_alliances : [];
    const rightAl = Array.isArray(projData?.right_alliances) ? projData.right_alliances : [];
    ['left1','left2','left3'].forEach((k, i) => {
      const el = document.getElementById(`lePL_${k}_alliance`);
      if (el) el.value = leftAl[i] || '';
    });
    ['right1','right2','right3'].forEach((k, i) => {
      const el = document.getElementById(`lePL_${k}_alliance`);
      if (el) el.value = rightAl[i] || '';
    });

    // 取玩家字典
    const dictRes = await fetch(`${base}/projects/${projectId}/player-dict`, { headers });
    const dictJson = await dictRes.json();
    const dictRows = Array.isArray(dictJson.data) ? dictJson.data : [];
    _leTestPlayerNames = [...new Set(dictRows.map(r => r.player_name).filter(Boolean))];
    _updatePlayerCount();

    if (msgEl) msgEl.textContent = `✅ 同盟 ${leftAl.length + rightAl.length} 个，玩家 ${_leTestPlayerNames.length} 个`;
  } catch (e) {
    if (msgEl) msgEl.textContent = '❌ ' + e.message;
  }
}

function _testBody(extra) {
  const allianceNames = [...new Set(_getTestAllianceSlots().map(x => x.allianceName).filter(Boolean))];
  const body = { projectId: _leProjectId, playerNames: _leTestPlayerNames, allianceNames, ...extra };
  if (_leImageToken) body.imageToken = _leImageToken;
  else body.imageBase64 = _leCurrentImageB64;
  return JSON.stringify(body);
}

// ── 测试识别 ──────────────────────────────────────────────────────────
async function leRunTest() {
  if (!_leCurrentImageB64) return alert('请先上传参考图片');
  _showTestModal('⏳ 正在识别中...');
  const token = typeof getToken === 'function' ? getToken() : '';
  try {
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(base + '/ocr-preview/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: _testBody({ categories: _buildCategories() }),
    });
    const data = await resp.json();
    if (data.code !== 200) {
      _showTestModal('❌ 请求失败: ' + (data.message || '未知错误'));
      return;
    }
    const d = data.data;
    _renderTestResult(
      '▶ 全字段测试',
      d.result || {},
      d.logs || [],
    );
  } catch (e) {
    _showTestModal('❌ 错误: ' + e.message);
  }
}

async function leRunTestSingle() {
  if (!_leCurrentImageB64) return alert('请先上传参考图片');
  if (_leSelIdx < 0) return alert('请先在左侧列表选中一个区域');
  const b = _leBoxes[_leSelIdx];
  const label = b.def.label;
  _showTestModal(`⏳ 正在识别"${label}"...`);
  const token = typeof getToken === 'function' ? getToken() : '';
  // 只打包选中的单个框
  const singleCategories = {};
  if (!singleCategories[b.def.cat]) singleCategories[b.def.cat] = { boxes: [] };
  singleCategories[b.def.cat].boxes.push({
    key: b.def.key,
    rx1: +b.rx1.toFixed(4), ry1: +b.ry1.toFixed(4),
    rx2: +b.rx2.toFixed(4), ry2: +b.ry2.toFixed(4),
  });
  try {
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(base + '/ocr-preview/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: _testBody({ categories: singleCategories }),
    });
    const data = await resp.json();
    if (data.code !== 200) {
      _showTestModal('❌ 请求失败: ' + (data.message || '未知错误'));
      return;
    }
    const d = data.data;
    // 过滤掉空值，只展示实际识别到的字段
    const rawResult = d.result || {};
    const filteredResult = {};
    for (const [k, v] of Object.entries(rawResult)) {
      if (v === null || v === '' || v === 0) continue;
      if (Array.isArray(v) && v.every(x => x === '' || x === 0 || x === null)) continue;
      filteredResult[k] = v;
    }
    _renderTestResult(`▶ 单框测试：${label}`, filteredResult, d.logs || []);
  } catch (e) {
    _showTestModal('❌ 错误: ' + e.message);
  }
}

async function leRunStars(mode) {
  if (!_leCurrentImageB64) return alert('请先上传参考图片');
  const modeLabel = { color: '颜色法', template: '模板法', both: '双校验' }[mode] || mode;
  _showTestModal(`⏳ 豆豆${modeLabel}识别中...`);
  const token = typeof getToken === 'function' ? getToken() : '';
  try {
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(base + '/ocr-preview/test-stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: _testBody({ categories: _buildCategories(), mode }),
    });
    const data = await resp.json();
    if (data.code !== 200) {
      _showTestModal('❌ 请求失败: ' + (data.message || '未知错误'));
      return;
    }
    const d = data.data;
    _renderTestResult(
      `⭐ 豆豆专项测试（${modeLabel}）`,
      d.result || {},
      d.logs || [],
    );
  } catch (e) {
    _showTestModal('❌ 错误: ' + e.message);
  }
}

function _showTestModal(placeholder) {
  const modal = document.getElementById('leTestModal');
  if (!modal) return;
  modal.style.display = 'block';
  const res = document.getElementById('leModalResult');
  const logs = document.getElementById('leModalLogs');
  if (res) res.textContent = placeholder;
  if (logs) logs.innerHTML = '';
}

function _renderTestResult(title, result, logs) {
  const titleEl = document.getElementById('leModalTitle');
  if (titleEl) titleEl.textContent = title;
  const res = document.getElementById('leModalResult');
  if (res) res.textContent = JSON.stringify(result, null, 2);
  const logEl = document.getElementById('leModalLogs');
  if (!logEl) return;
  logEl.innerHTML = logs.map(line => {
    const color = line.includes('✅') ? 'var(--accent)' :
                  line.includes('❌') ? '#e74c3c' :
                  line.includes('⚠️') ? '#f39c12' :
                  line.includes('❓') ? '#3498db' :
                  'var(--text2)';
    return `<div style="color:${color};border-bottom:1px solid rgba(255,255,255,0.04);padding:2px 0;">${escHtml(line)}</div>`;
  }).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 方案管理（localStorage）──────────────────────────────────────────
const LE_SCHEME_LIST_KEY = 'le_scheme_list';

// ========== 方案管理：从 localStorage 迁移到数据库 API ==========
async function _getSchemeNames() {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(`${base}/ocr-schemes`, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const data = await resp.json();
    if (data.code === 200 && Array.isArray(data.data)) {
      return data.data.map(item => item.name);
    }
    return [];
  } catch (e) {
    console.error('[OCR方案] 获取方案列表失败:', e);
    return [];
  }
}

function _saveSchemeNames(names) {
  // 已迁移到数据库，此函数保留空实现以兼容旧代码
}

async function _getSchemeData(name) {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const url = `${base}/ocr-schemes/${encodeURIComponent(name)}`;
    console.log('[_getSchemeData] 请求URL:', url);
    console.log('[_getSchemeData] Token:', token ? 'Bearer ' + token.substring(0, 20) + '...' : '无');

    const resp = await fetch(url, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const data = await resp.json();
    console.log('[_getSchemeData] API响应:', JSON.stringify(data, null, 2));

    if (data.code === 200 && data.data) {
      const result = {
        imageB64: '',
        imageW: data.data.imageWidth,
        imageH: data.data.imageHeight,
        boxes: data.data.boxes,
        testAllianceSlots: data.data.testAllianceSlots,
        testPlayerNames: data.data.testPlayerNames,
      };
      console.log('[_getSchemeData] 返回数据，boxes数量:', result.boxes?.length);
      return result;
    }
    console.warn('[_getSchemeData] API返回非200或无data字段');
    return null;
  } catch (e) {
    console.error('[OCR方案] 获取方案数据失败:', e);
    return null;
  }
}

async function _saveSchemeData(name, data) {
  try {
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(`${base}/ocr-schemes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        name: name,
        imageWidth: data.imageW,
        imageHeight: data.imageH,
        imageBase64: data.imageB64,
        boxes: data.boxes,
        testAllianceSlots: data.testAllianceSlots,
        testPlayerNames: data.testPlayerNames,
      }),
    });
    const result = await resp.json();
    if (result.code !== 200) {
      throw new Error(result.message || '保存失败');
    }
  } catch (e) {
    console.error('[OCR方案] 保存方案失败:', e);
    throw e;
  }
}

async function _renderSchemeSelect() {
  const names = await _getSchemeNames();
  ['leSchemeSelect', 'leBindSchemeSelect'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 选择方案 —</option>';
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });
    if (cur && names.includes(cur)) sel.value = cur;
  });
}


async function leLoadScheme(name) {
  if (!name) return;
  _setStatus('⏳ 加载方案中...');
  const scheme = await _getSchemeData(name);
  if (!scheme) { _setStatus(`❌ 方案"${name}"数据丢失`); return; }

  // 如果方案没有图片数据，但当前已有图片加载，则复用当前图片
  if (!scheme.imageB64 && _leImg) {
    console.log('[leLoadScheme] 方案无图片，复用当前图片');
    _leImgW = scheme.imageW || _leImgW;
    _leImgH = scheme.imageH || _leImgH;

    // 强制重新初始化 boxes（可能已有旧状态）
    _leBoxes = LE_BOX_DEFS.map((def, i) => {
      const coords = scheme.boxes[i];
      if (coords) {
        return { def, rx1: coords.rx1, ry1: coords.ry1, rx2: coords.rx2, ry2: coords.ry2 };
      }
      const d = (LE_DEFAULTS[def.cat] || {})[def.key] || [0.1, 0.1, 0.3, 0.2];
      return { def, rx1: d[0], ry1: d[1], rx2: d[2], ry2: d[3] };
    });
    _leBoxesFromRealSource = true;
    _leSelIdx = -1;

    _clearTestAllianceSlots();
    if (scheme.testAllianceSlots) _setTestAllianceSlots(scheme.testAllianceSlots);
    _leTestPlayerNames = Array.isArray(scheme.testPlayerNames) ? scheme.testPlayerNames.slice() : [];
    _updatePlayerCount();

    _showEditorWrap();
    _resizeCanvas();
    _renderCanvas();
    _renderBoxList();
    _updateSelPanel();
    _setStatus(`✅ 已加载方案"${name}"（使用当前图片）`);
    return;
  }

  // 如果方案没有图片且当前也没有图片，提示用户先上传
  if (!scheme.imageB64) {
    _setStatus(`❌ 请先上传战报图片，然后再加载方案`);
    return;
  }

  const img = new Image();
  img.onload = () => {
    _leImg = img;
    _leImgW = scheme.imageW;
    _leImgH = scheme.imageH;
    _leCurrentImageB64 = scheme.imageB64;
    _leImageToken = '';  // 重置缓存 token，加载完后重新缓存
    _leCacheImage();

    // 强制重新初始化 boxes（可能已有旧状态）
    _leBoxes = LE_BOX_DEFS.map((def, i) => {
      const coords = scheme.boxes[i];
      if (coords) {
        return { def, rx1: coords.rx1, ry1: coords.ry1, rx2: coords.rx2, ry2: coords.ry2 };
      }
      const d = (LE_DEFAULTS[def.cat] || {})[def.key] || [0.1, 0.1, 0.3, 0.2];
      return { def, rx1: d[0], ry1: d[1], rx2: d[2], ry2: d[3] };
    });
    _leBoxesFromRealSource = true;
    _leSelIdx = -1;

    _clearTestAllianceSlots();
    if (scheme.testAllianceSlots) _setTestAllianceSlots(scheme.testAllianceSlots);
    _leTestPlayerNames = Array.isArray(scheme.testPlayerNames) ? scheme.testPlayerNames.slice() : [];
    _updatePlayerCount();

    _showEditorWrap();
    _resizeCanvas();
    _renderCanvas();
    _renderBoxList();
    _updateSelPanel();
    _setStatus(`✅ 已加载方案"${name}"`);
  };
  img.onerror = () => _setStatus(`❌ 方案"${name}"图片加载失败`);
  img.src = scheme.imageB64;
}

async function leDeleteScheme() {
  const sel = document.getElementById('leSchemeSelect');
  const name = sel?.value;
  if (!name) { _setStatus('请先选择一个方案'); return; }
  if (!confirm(`确定删除方案"${name}"？`)) return;

  try {
    _setStatus('⏳ 删除中...');
    const token = typeof getToken === 'function' ? getToken() : '';
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    const resp = await fetch(`${base}/ocr-schemes/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const result = await resp.json();
    if (result.code !== 200) {
      throw new Error(result.message || '删除失败');
    }
    await _renderSchemeSelect();
    _setStatus(`✅ 已删除方案"${name}"`);
  } catch (e) {
    _setStatus('❌ 删除失败: ' + e.message);
  }
}

// ── 从数据库已绑定配置还原方案 ───────────────────────────────────────
async function leRestoreFromDB() {
  try {
    const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
    // 尝试当前项目，没有则用全局(0)
    const pid = _leProjectId || 0;
    const res = await fetch(`${base}/label-config/${pid}`);
    const json = await res.json();
    if (json.code !== 200 || !json.data?.categories) {
      _setStatus('❌ 数据库中未找到配置'); return;
    }
    const { imageWidth, imageHeight, categories, isGlobal } = json.data;
    const schemeName = isGlobal ? '数据库全局配置' : `数据库项目${pid}配置`;
    // 将 categories 结构转换为 boxes 数组（与 LE_BOX_DEFS 一一对应）
    const boxes = LE_BOX_DEFS.map(def => {
      const cat = categories[def.cat];
      const box = cat?.boxes?.find(b => b.key === def.key);
      if (box) return { rx1: box.rx1, ry1: box.ry1, rx2: box.rx2, ry2: box.ry2 };
      // 找不到则用默认值
      const d = (LE_DEFAULTS[def.cat] || {})[def.key] || [0.1, 0.1, 0.3, 0.2];
      return { rx1: d[0], ry1: d[1], rx2: d[2], ry2: d[3] };
    });
    const names = await _getSchemeNames();
    if (names.includes(schemeName) && !confirm(`"${schemeName}"已存在，覆盖？`)) return;
    await _saveSchemeData(schemeName, { name: schemeName, imageB64: '', imageW: imageWidth || 0, imageH: imageHeight || 0, boxes });
    await _renderSchemeSelect();
    const sel = document.getElementById('leSchemeSelect');
    if (sel) sel.value = schemeName;
    _setStatus(`✅ 已从数据库还原"${schemeName}"（${imageWidth}×${imageHeight}）`);
  } catch (e) {
    _setStatus('❌ 还原失败：' + e.message);
  }
}

// ── 从系统默认坐标生成方案 ────────────────────────────────────────────
async function leCreateDefaultScheme() {
  const DEFAULT_NAME = '系统默认方案';
  const names = await _getSchemeNames();
  if (names.includes(DEFAULT_NAME)) {
    if (!confirm(`"${DEFAULT_NAME}"已存在，是否覆盖？`)) return;
  }
  const boxes = LE_BOX_DEFS.map(def => {
    const d = (LE_DEFAULTS[def.cat] || {})[def.key] || [0.1, 0.1, 0.3, 0.2];
    return { rx1: d[0], ry1: d[1], rx2: d[2], ry2: d[3] };
  });
  const schemeData = { name: DEFAULT_NAME, imageB64: '', imageW: 0, imageH: 0, boxes };
  await _saveSchemeData(DEFAULT_NAME, schemeData);
  await _renderSchemeSelect();
  const sel = document.getElementById('leSchemeSelect');
  if (sel) sel.value = DEFAULT_NAME;
  _setStatus(`✅ 已生成"${DEFAULT_NAME}"，可在下拉中选择`);
}

// ── 导出所有方案 ──────────────────────────────────────────────────────
async function leExportSchemes() {
  const names = await _getSchemeNames();
  if (names.length === 0) { _setStatus('❌ 当前没有任何方案可导出'); return; }
  const payload = { version: 1, exportedAt: new Date().toISOString(), schemes: {} };
  for (const n of names) {
    payload.schemes[n] = await _getSchemeData(n);
  }
  const json = JSON.stringify(payload, null, 2);
  const defaultName = `ocr_schemes_${new Date().toISOString().slice(0,10)}.json`;

  if (window.showSaveFilePicker) {
    try {
      const fh = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await fh.createWritable();
      await writable.write(json);
      await writable.close();
      _setStatus(`✅ 已导出 ${names.length} 个方案`);
    } catch (e) {
      if (e.name !== 'AbortError') _setStatus('❌ 导出失败：' + e.message);
    }
  } else {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = defaultName;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    _setStatus(`✅ 已导出 ${names.length} 个方案`);
  }
}

// ── 导入方案（从 JSON 文件）────────────────────────────────────────────
function leImportSchemes() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const payload = JSON.parse(e.target.result);
        if (!payload.schemes || typeof payload.schemes !== 'object') throw new Error('格式不正确');
        const incoming = Object.keys(payload.schemes);
        if (incoming.length === 0) { _setStatus('❌ 文件中没有方案数据'); return; }
        const names = await _getSchemeNames();
        const overwrite = incoming.filter(n => names.includes(n));
        if (overwrite.length > 0) {
          if (!confirm(`以下方案已存在，导入将覆盖：\n${overwrite.join('、')}\n\n继续？`)) return;
        }
        for (const n of incoming) {
          await _saveSchemeData(n, payload.schemes[n]);
        }
        await _renderSchemeSelect();
        _setStatus(`✅ 已导入 ${incoming.length} 个方案：${incoming.join('、')}`);
      } catch (err) {
        _setStatus(`❌ 导入失败：${err.message}`);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

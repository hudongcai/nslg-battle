/* ==========================================================
   积分商城 - 前端逻辑（联系管理员版）
   ========================================================== */

console.log('[PointsMall] 积分商城模块加载（联系管理员版 v2026050401）');

// ========== 套餐配置 ==========
const POINTS_PACKAGES = [
  { id: 'p1',  price: 1,   points: 40,    label: '尝鲜',     tag: '' },
  { id: 'p2',  price: 6,   points: 250,   label: '小杯',     tag: '' },
  { id: 'p3',  price: 18,  points: 800,   label: '中杯',     tag: '推荐' },
  { id: 'p4',  price: 30,  points: 1400,  label: '大杯',     tag: '' },
  { id: 'p5',  price: 68,  points: 3300,  label: '超实惠',   tag: '划算' },
  { id: 'p6',  price: 118, points: 6000,  label: '年度会员', tag: '超值' },
  { id: 'p7',  price: 198, points: 10500, label: '超级套餐', tag: '' },
  { id: 'p8',  price: 348, points: 20000, label: '年度畅享', tag: 'VIP' },
  { id: 'p9',  price: 648, points: 38800, label: '至尊豪华', tag: '' },
];

// 管理员联系方式
const ADMIN_CONTACT = {
  wechat: 'jh20201028',
  wechatQr: 'wechat_qr.png',
};

// 截图工具包月套餐
const TOOL_PACKAGE = {
  price: 18,
  label: '截图工具',
  sub: '包月授权',
  note: '请联系管理员，支付月费后获取授权序列号',
};

// ========== 工具函数 ==========
function getPkgById(packageId) {
  return POINTS_PACKAGES.find(p => p.id === packageId) || null;
}

function getTagStyle(tag) {
  if (tag === '推荐') return 'background:rgba(240,180,41,.2);color:#f0b429;';
  if (tag === '划算') return 'background:rgba(81,207,102,.2);color:#51cf66;';
  if (tag === '超值') return 'background:rgba(255,107,107,.2);color:#ff6b6b;';
  if (tag === 'VIP')  return 'background:rgba(116,192,252,.2);color:#74c0fc;';
  return '';
}

// ========== 积分商城入口 ==========
function showPointsMall() {
  const modal = document.getElementById('pointsMallModal');
  if (modal) {
    modal.style.display = 'flex';
    renderPointsMall();
  } else {
    console.error('[PointsMall] #pointsMallModal 未找到');
  }
}

function closePointsMall() {
  const modal = document.getElementById('pointsMallModal');
  if (modal) modal.style.display = 'none';
}

// ========== 渲染积分商城主界面 ==========
async function renderPointsMall() {
  const content = document.getElementById('mallContent');
  if (!content) return;

  content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text2);">⏳ 加载中...</div>';

  try {
    const points = await getUserPoints(currentUser.phone);

    // —— 我的积分（居中）——
    let html = `
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:13px;color:var(--text2);margin-bottom:4px;">我的积分</div>
        <div style="font-size:32px;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${points.toLocaleString()}</div>
      </div>

      <div class="mall-section-title" style="margin-bottom:12px;">💰 积分充值</div>
      <div class="mall-grid">
    `;

    // —— 充值套餐卡片 ——
    for (const p of POINTS_PACKAGES) {
      const tagHtml = p.tag
        ? `<span class="pkg-tag" style="${getTagStyle(p.tag)}">${p.tag}</span>`
        : '';
      html += `
        <div class="pkg-card" onclick="openContactAdmin('${p.id}')">
          ${tagHtml}
          <div class="pkg-points">${p.points.toLocaleString()} <span>积分</span></div>
          <div class="pkg-price">¥${p.price}</div>
          <div class="pkg-label">${p.label}</div>
        </div>
      `;
    }

    // —— 截图工具卡片（占 3 列）——
    html += `
        <div class="pkg-card pkg-tool" style="grid-column:span 3;display:flex;flex-direction:column;align-items:center;gap:8px;"
             onclick="openToolContact()">
          <span class="pkg-tag" style="background:rgba(81,207,102,.2);color:#51cf66;">工具</span>
          <div style="font-size:18px;font-weight:700;color:var(--text);">${TOOL_PACKAGE.label}</div>
          <div style="font-size:14px;color:var(--accent);font-weight:700;">¥${TOOL_PACKAGE.price}/月</div>
          <div style="font-size:12px;color:var(--text2);">${TOOL_PACKAGE.sub}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px;">📦 含安装包 + 序列号授权</div>
        </div>
      `;

    html += '</div>';  // .mall-grid

    // —— 充值说明（简化）——
    html += `
      <div style="margin-top:20px;padding:14px 16px;background:var(--bg2);border-radius:8px;font-size:13px;color:var(--text2);line-height:1.8;text-align:center;">
        请联系管理员，完成充值。
      </div>
    `;

    // —— 管理员联系方式（居中）——
    html += `
      <div style="margin-top:16px;display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px;background:var(--bg2);border-radius:8px;">
        <div style="font-size:13px;color:var(--text2);font-weight:600;">管理员联系方式</div>
        ${ADMIN_CONTACT.wechatQr
          ? `<img src="${ADMIN_CONTACT.wechatQr}" style="width:120px;height:120px;object-fit:contain;border-radius:8px;">`
          : ''}
        <div style="font-size:15px;font-weight:700;color:var(--accent);">${ADMIN_CONTACT.wechat}</div>
        <div style="font-size:12px;color:var(--text3);">微信扫码添加好友</div>
      </div>
    `;

    content.innerHTML = html;
    console.log('[PointsMall] 渲染完成，当前积分:', points);
  } catch (e) {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#ff5252;">❌ 加载失败：${e.message}</div>`;
  }
}

// ========== 联系管理员弹窗（充值套餐）==========
function openContactAdmin(packageId) {
  const pkg = getPkgById(packageId);
  if (!pkg) return;

  const modal = document.getElementById('rechargeModal');  // 复用充值弹窗
  if (!modal) return;

  const qrHtml = ADMIN_CONTACT.wechatQr
    ? `<img src="${ADMIN_CONTACT.wechatQr}" style="width:180px;height:180px;object-fit:contain;border-radius:8px;" alt="管理员微信">`
    : '<div style="font-size:48px;">💬</div>';

  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;width:90%;max-width:360px;overflow:hidden;">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--bg3);">
        <h3 style="margin:0;color:var(--accent);font-size:16px;">📱 联系管理员</h3>
        <button onclick="closeRechargeModal()" style="background:none;border:none;color:var(--text2);font-size:22px;cursor:pointer;">&times;</button>
      </div>
      <div style="padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;">
        ${qrHtml}
        <div style="font-size:15px;font-weight:700;color:var(--text);">管理员微信</div>
        <div style="font-size:20px;font-weight:800;color:var(--accent);">${ADMIN_CONTACT.wechat}</div>
        <div style="font-size:12px;color:var(--text2);background:var(--bg2);border-radius:8px;padding:10px 14px;width:100%;line-height:1.8;">
          请截图此页面，<b>扫码添加好友</b>后发送<br>
          <b>充值需求</b>，管理员确认后会为您手动<br>
          <b style="color:var(--accent);">增加 ${pkg.points.toLocaleString()} 积分</b>
        </div>
        <div style="font-size:12px;color:var(--text3);">套餐：${pkg.label} · ¥${pkg.price} · ${pkg.points.toLocaleString()}积分</div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  addSysLog('action', `用户查看充值联系页: ${pkg.label}（${pkg.price}元/${pkg.points}积分）`);
}

function closeRechargeModal() {
  const modal = document.getElementById('rechargeModal');
  if (modal) modal.style.display = 'none';
}

// ========== 截图工具联系管理员弹窗 ==========
function openToolContact() {
  const modal = document.getElementById('rechargeModal');
  if (!modal) return;

  const qrHtml = ADMIN_CONTACT.wechatQr
    ? `<img src="${ADMIN_CONTACT.wechatQr}" style="width:180px;height:180px;object-fit:contain;border-radius:8px;" alt="管理员微信">`
    : '<div style="font-size:48px;">💬</div>';

  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;width:90%;max-width:380px;overflow:hidden;">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--bg3);">
        <h3 style="margin:0;color:var(--accent);font-size:16px;">📱 截图工具授权</h3>
        <button onclick="closeRechargeModal()" style="background:none;border:none;color:var(--text2);font-size:22px;cursor:pointer;">&times;</button>
      </div>
      <div style="padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;">
        ${qrHtml}
        <div style="font-size:15px;font-weight:700;color:var(--text);">管理员微信</div>
        <div style="font-size:20px;font-weight:800;color:var(--accent);">${ADMIN_CONTACT.wechat}</div>
        <div style="font-size:12px;color:var(--text2);background:var(--bg2);border-radius:8px;padding:12px 16px;width:100%;line-height:1.8;">
          ${TOOL_PACKAGE.note}<br>
          支付后管理员将发送：<br>
          📦 <b>安装包下载地址</b><br>
          🔑 <b>授权序列号</b>
        </div>
        <div style="font-size:12px;color:var(--text3);">套餐：截图工具 · ¥${TOOL_PACKAGE.price}/月</div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  addSysLog('action', `用户查看截图工具联系页`);
}

console.log('[PointsMall] 积分商城模块加载完成（联系管理员版 v2026050401）');

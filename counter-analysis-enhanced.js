/**
 * 克制分析模块增强功能
 * 提供竖向排列布局和高级筛选功能
 */

// 武将竖向列表
function verticalGeneralsList(generals) {
  if (!generals || generals.length === 0) return '<span style="color:var(--text3);">-</span>';
  return generals.map(g => `<div style="padding:2px 0;font-size:12px;font-weight:bold;color:var(--cyan);">${g}</div>`).join('');
}

// 竖向排列队伍显示（每行一个武将+战法）
function verticalTeamRowHtml(generals, tactics) {
  if (!generals || generals.length === 0) return '<span style="color:var(--text3);">-</span>';
  const tacs = tactics || [];
  return generals.map((g, i) => {
    const base = i * 3;
    const gt = [tacs[base] || '', tacs[base + 1] || '', tacs[base + 2] || ''].filter(t => t && t !== '未知');
    const tStr = gt.length ? gt.map(t => `<span style="display:inline-block;background:rgba(74,144,217,0.15);color:var(--blue);padding:1px 4px;border-radius:3px;font-size:10px;margin-right:2px;">${t}</span>`).join('') : '<span style="color:var(--text3);font-size:10px;">-</span>';
    return `<div style="display:flex;gap:6px;align-items:center;padding:2px 0;border-bottom:1px solid rgba(128,128,128,0.1);">
      <span style="min-width:60px;font-size:12px;font-weight:bold;color:var(--cyan);">${g}</span>
      <span style="flex:1;">${tStr}</span>
    </div>`;
  }).join('');
}

// 武将竖向列表
function verticalGeneralsList(generals) {
  if (!generals || generals.length === 0) return '<span style="color:var(--text3);">-</span>';
  return generals.map(g => `<div style="padding:2px 0;font-size:12px;font-weight:bold;color:var(--cyan);">${g}</div>`).join('');
}

// 战法竖向列表（每行一个武将的战法）
function verticalTacticsOnlyList(tactics) {
  const tacs = tactics || [];
  if (!tacs.length) return '<span style="color:var(--text3);">-</span>';
  // 每3个战法一组
  let groups = [];
  for (let i = 0; i < tacs.length; i += 3) {
    const group = [tacs[i] || '', tacs[i + 1] || '', tacs[i + 2] || ''].filter(t => t && t !== '未知');
    const tStr = group.length ? group.map(t => `<span style="display:inline-block;background:rgba(74,144,217,0.15);color:var(--blue);padding:1px 4px;border-radius:3px;font-size:10px;margin-right:2px;">${t}</span>`).join('') : '<span style="color:var(--text3);font-size:10px;">-</span>';
    groups.push(`<div style="padding:2px 0;height:20px;">${tStr}</div>`);
  }
  return groups.join('');
}

// 敌方高频排序状态
let efSortField = 'count';
let efSortDir = 'desc';

// 切换敌方高频排序
function toggleEFSort(field) {
  if (efSortField === field) {
    efSortDir = efSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    efSortField = field;
    efSortDir = 'desc';
  }
  renderEnemyFreq();
}

// 增强版renderEnemyFreq（支持竖向排列和高级筛选）
function renderEnemyFreqEnhanced() {
  const search = (document.getElementById('efSearch')?.value || '').toLowerCase();
  const searchGen = (document.getElementById('efSearchGeneral')?.value || '').toLowerCase();
  const searchTac = (document.getElementById('efSearchTactic')?.value || '').toLowerCase();
  const searchForm = (document.getElementById('efSearchFormation')?.value || '').toLowerCase();

  // 统计右侧（敌方）队伍
  const map = new Map(); // teamKey -> {generals, tactics, formation, count, wins, losses, draws, recordIds}

  if (typeof allRecords !== 'undefined') {
    allRecords.forEach(r => {
      const key = getTeamKey(r.rightGenerals);
      if (!key || key === '未知') return;

      // 关键词筛选
      if (search && !key.toLowerCase().includes(search)) return;
      if (searchGen && !r.rightGenerals.some(g => g && g.toLowerCase().includes(searchGen))) return;
      if (searchTac && !(r.rightTactics || []).some(t => t && t.toLowerCase().includes(searchTac))) return;
      if (searchForm && !(r.rightFormation || '').toLowerCase().includes(searchForm)) return;

      if (!map.has(key)) map.set(key, {
        generals: r.rightGenerals,
        tactics: r.rightTactics,
        formation: r.rightFormation || '',
        count: 0, wins: 0, losses: 0, draws: 0, recordIds: []
      });
      const d = map.get(key);
      d.count++;
      d.recordIds.push(r.id);
      if (r.result === '胜') d.wins++;
      else if (r.result === '败') d.losses++;
      else d.draws++;
      // 如果该record的generals比已存的更完整，更新一下
      if ((r.rightGenerals || []).filter(g => g).length > (d.generals || []).filter(g => g).length) {
        d.generals = r.rightGenerals;
        d.tactics = r.rightTactics;
        d.formation = r.rightFormation || '';
      }
    });
  }

  const totalRecords = (typeof allRecords !== 'undefined' ? allRecords.length : 0) || 1;
  let list = [...map.values()];

  // 排序
  list.sort((a, b) => {
    let va, vb;
    switch (efSortField) {
      case 'count': va = a.count; vb = b.count; break;
      default: va = a.count; vb = b.count;
    }
    return efSortDir === 'asc' ? va - vb : vb - va;
  });

  const filteredCount = list.reduce((s, d) => s + d.count, 0);
  const totalLabel = search || searchGen || searchTac || searchForm
    ? `共 ${filteredCount} 场（筛选） / ${totalRecords} 场（全部）· ${list.length} 种队伍`
    : `共 ${totalRecords} 场战报 · ${list.length} 种队伍`;

  const efTotalEl = document.getElementById('efTotal');
  if (efTotalEl) efTotalEl.textContent = totalLabel;

  const tbody = document.getElementById('efTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3);">暂无数据</td></tr>';
    return;
  }

  const maxCount = list[0].count;
  tbody.innerHTML = list.map((d, i) => {
    const pct = (d.count / totalRecords * 100).toFixed(1);
    const barW = Math.round(d.count / maxCount * 100);
    const wr = d.count > 0 ? (d.wins / d.count * 100).toFixed(0) : 0;
    const wrColor = wr >= 60 ? 'var(--green)' : wr >= 40 ? 'var(--accent)' : 'var(--red)';

    return `<tr>
      <td style="text-align:center;font-weight:bold;color:${i < 3 ? 'var(--accent)' : 'var(--text2)'};vertical-align:middle;">${i + 1}</td>
      <td style="min-width:60px;vertical-align:middle;text-align:center;">${verticalGeneralsList(d.generals)}</td>
      <td style="min-width:180px;vertical-align:middle;text-align:left;">${verticalTacticsOnlyList(d.tactics)}</td>
      <td style="text-align:center;color:var(--text2);vertical-align:middle;">${d.formation || '-'}</td>
      <td style="text-align:center;font-weight:bold;font-size:14px;color:var(--blue);vertical-align:middle;">${d.count}</td>
      <td style="vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;background:var(--border);border-radius:3px;height:6px;min-width:60px;">
            <div style="width:${barW}%;background:var(--blue);height:6px;border-radius:3px;"></div>
          </div>
          <span style="font-size:11px;color:var(--text2);white-space:nowrap;">${pct}%</span>
        </div>
      </td>
      <td style="text-align:center;font-size:11px;white-space:nowrap;vertical-align:middle;">
        <span style="color:var(--green);">${d.wins}胜</span> /
        <span style="color:var(--red);">${d.losses}败</span> /
        <span style="color:var(--text2);">${d.draws}平</span>
      </td>
      <td style="text-align:center;font-weight:bold;color:${wrColor};vertical-align:middle;">${d.count > 0 ? wr + '%' : '-'}</td>
    </tr>`;
  }).join('');
}

// 增强版renderWinRateTable（支持竖向排列和高级筛选）
function renderWinRateTableEnhanced() {
  let data = typeof computeWinRateData === 'function' ? computeWinRateData() : [];
  if (typeof cachedWinRateData !== 'undefined') cachedWinRateData = data;

  // 新的筛选框 ID
  const searchLeftGen = (document.getElementById('wrSearchLeftGeneral')?.value || '').toLowerCase();
  const searchLeftTac = (document.getElementById('wrSearchLeftTactic')?.value || '').toLowerCase();
  const searchLeftForm = (document.getElementById('wrSearchLeftFormation')?.value || '').toLowerCase();
  const searchRightGen = (document.getElementById('wrSearchRightGeneral')?.value || '').toLowerCase();
  const searchRightTac = (document.getElementById('wrSearchRightTactic')?.value || '').toLowerCase();
  const searchRightForm = (document.getElementById('wrSearchRightFormation')?.value || '').toLowerCase();
  const fL = document.getElementById('wrFilterLeft')?.value || '';
  const fR = document.getElementById('wrFilterRight')?.value || '';

  // 胜方筛选
  if (searchLeftGen) data = data.filter(d => d.leftGenerals.some(g => g && g.toLowerCase().includes(searchLeftGen)));
  if (searchLeftTac) data = data.filter(d => (d.leftTactics || []).some(t => t && t.toLowerCase().includes(searchLeftTac)));
  if (searchLeftForm) data = data.filter(d => (d.leftFormation || '').toLowerCase().includes(searchLeftForm));

  // 败方筛选
  if (searchRightGen) data = data.filter(d => d.rightGenerals.some(g => g && g.toLowerCase().includes(searchRightGen)));
  if (searchRightTac) data = data.filter(d => (d.rightTactics || []).some(t => t && t.toLowerCase().includes(searchRightTac)));
  if (searchRightForm) data = data.filter(d => (d.rightFormation || '').toLowerCase().includes(searchRightForm));

  if (fL) data = data.filter(d => d.leftTeam === fL);
  if (fR) data = data.filter(d => d.rightTeam === fR);

  // 使用全局排序状态
  if (typeof winRateSortField !== 'undefined' && winRateSortField) {
    data.sort((a, b) => {
      let va, vb;
      switch (winRateSortField) {
        case 'leftTeam': va = a.leftTeam; vb = b.leftTeam; break;
        case 'rightTeam': va = a.rightTeam; vb = b.rightTeam; break;
        case 'count': va = a.total; vb = b.total; break;
        case 'winRate': va = a.winRate; vb = b.winRate; break;
        case 'lossRate': va = parseFloat(a.lossRateVal); vb = parseFloat(b.lossRateVal); break;
        case 'leftLossPct': va = a.avgLLoss || 0; vb = b.avgLLoss || 0; break;
        case 'rightLossPct': va = a.avgRLoss || 0; vb = b.avgRLoss || 0; break;
        default: return 0;
      }
      if (typeof va === 'string') return winRateSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return winRateSortDir === 'asc' ? va - vb : vb - va;
    });
  } else {
    data.sort((a, b) => b.winRate - a.winRate);
  }

  const tbody = document.getElementById('winRateTableBody');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text3);">暂无对战数据</td></tr>';
  } else {
    tbody.innerHTML = data.map((d, di) => {
      const wrCls = d.winRate >= 60 ? 'wr-high' : d.winRate >= 40 ? 'wr-mid' : 'wr-low';
      const barCls = d.winRate >= 60 ? 'bar-green' : d.winRate >= 40 ? 'bar-yellow' : 'bar-red';
      const barW = Math.min(d.winRate, 100);
      const lossRatio = d.lossRateVal;
      const lossColor = parseFloat(lossRatio) <= 50 ? 'var(--green)' : parseFloat(lossRatio) >= 100 ? 'var(--red)' : 'var(--accent)';

      return `<tr>
        <td style="min-width:60px;vertical-align:middle;text-align:center;">${verticalGeneralsList(d.leftGenerals)}</td>
        <td style="min-width:180px;vertical-align:middle;text-align:left;">${verticalTacticsOnlyList(d.leftTactics)}</td>
        <td style="text-align:center;color:var(--text2);vertical-align:middle;">${d.leftFormation || ''}</td>
        <td style="text-align:center;vertical-align:middle;"><span class="wr ${wrCls}" style="font-size:12px;font-weight:900;">${d.winRate.toFixed(0)}%</span><span class="wr-bar ${barCls}" style="width:${barW}px;display:inline-block;"></span></td>
        <td class="num" style="font-weight:900;font-size:12px;color:${lossColor};vertical-align:middle;">${lossRatio}%</td>
        <td class="num" style="color:var(--text3);font-size:11px;vertical-align:middle;">${d.total}</td>
        <td style="min-width:60px;vertical-align:middle;text-align:center;">${verticalGeneralsList(d.rightGenerals)}</td>
        <td style="min-width:180px;vertical-align:middle;text-align:left;">${verticalTacticsOnlyList(d.rightTactics)}</td>
        <td style="text-align:center;color:var(--text2);vertical-align:middle;">${d.rightFormation || ''}</td>
        <td style="text-align:center;vertical-align:middle;"><a href="javascript:void(0)" onclick="showTraceByRecords([${d.recordIds.join(',')}],'${typeof escHtml === 'function' ? escHtml(d.leftTeam) : d.leftTeam}','${typeof escHtml === 'function' ? escHtml(d.rightTeam) : d.rightTeam}')" style="color:var(--accent);text-decoration:underline;font-size:12px;">📋 溯源</a></td>
      </tr>`;
    }).join('');
  }

  if (typeof renderRestrictCards === 'function') renderRestrictCards(data);
}

// 重写原函数
if (typeof renderEnemyFreq === 'function') {
  const originalRenderEnemyFreq = renderEnemyFreq;
  renderEnemyFreq = renderEnemyFreqEnhanced;
}

// 延迟覆盖 renderWinRateTable 以确保在所有内联脚本执行后
setTimeout(() => {
  window.renderWinRateTable = renderWinRateTableEnhanced;
  console.log('[counter-analysis-enhanced] renderWinRateTable 已覆盖');
  // 如果数据已加载，立即刷新表格
  if (typeof allRecords !== 'undefined' && allRecords.length > 0) {
    renderWinRateTableEnhanced();
  }
}, 100);

// 增强版 renderCounterPick - 使用竖向排列布局
function renderCounterPickEnhanced(dominantPairs, dominatedPairs) {
  const section = document.getElementById('counterSection');
  const container = document.getElementById('counterCards');
  if (typeof allRecords === 'undefined' || allRecords.length === 0) {
    section.style.display = 'none';
    return;
  }

  // 统计右侧（敌方）队伍
  const enemyMap = new Map();
  allRecords.forEach(r => {
    const key = typeof getTeamKey === 'function' ? getTeamKey(r.rightGenerals) : (r.rightGenerals || []).join(',');
    if (!key || key === '未知') return;
    if (!enemyMap.has(key)) enemyMap.set(key, {
      generals: r.rightGenerals,
      tactics: r.rightTactics,
      formation: r.rightFormation || '',
      count: 0, recordIds: []
    });
    const d = enemyMap.get(key);
    d.count++;
    d.recordIds.push(r.id);
    if ((r.rightGenerals || []).filter(g => g).length > (d.generals || []).filter(g => g).length) {
      d.generals = r.rightGenerals;
      d.tactics = r.rightTactics;
      d.formation = r.rightFormation || '';
    }
  });

  const enemyList = [...enemyMap.values()].sort((a, b) => b.count - a.count);
  if (enemyList.length === 0) {
    section.style.display = 'none';
    return;
  }

  // 构建克制映射
  const counterMap = new Map();
  dominantPairs.forEach(d => {
    const ek = typeof getTeamKey === 'function' ? getTeamKey(d.dominatedGens) : (d.dominatedGens || []).join(',');
    if (!counterMap.has(ek)) counterMap.set(ek, []);
    counterMap.get(ek).push({
      team: d.dominant, generals: d.dominantGens, tactics: d.dominantTacs,
      winRate: d.winRate, total: d.total, lossRate: d.lossRateVal,
      recordIds: d.recordIds, type: 'counter'
    });
  });

  const weakMap = new Map();
  dominatedPairs.forEach(d => {
    const ek = typeof getTeamKey === 'function' ? getTeamKey(d.dominantGens) : (d.dominantGens || []).join(',');
    if (!weakMap.has(ek)) weakMap.set(ek, []);
    weakMap.get(ek).push({
      team: d.dominated, generals: d.dominatedGens, tactics: d.dominatedTacs,
      winRate: d.winRate, total: d.total, lossRate: d.lossRateVal,
      recordIds: d.recordIds, type: 'weak'
    });
  });

  section.style.display = 'block';

  // 生成克制推荐卡片 - 竖向排列布局
  let html = '';
  enemyList.slice(0, 5).forEach(enemy => {
    const ek = typeof getTeamKey === 'function' ? getTeamKey(enemy.generals) : (enemy.generals || []).join(',');
    const counters = counterMap.get(ek) || [];
    const weaks = weakMap.get(ek) || [];

    html += `<div style="background:var(--bg2);border-radius:8px;border:1px solid var(--border);margin-bottom:12px;overflow:hidden;">`;
    html += `<div style="background:var(--bg3);padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">`;
    html += `<span style="font-size:12px;font-weight:bold;color:var(--accent);">敌方高频队伍</span>`;
    html += `<span style="font-size:11px;color:var(--text3);">出现 ${enemy.count} 次</span>`;
    html += `</div>`;

    // 敌方队伍信息 - 竖向排列
    html += `<div style="padding:12px;border-bottom:1px solid var(--border);background:rgba(255,107,107,0.05);">`;
    html += `<div style="font-size:11px;color:var(--text3);margin-bottom:8px;">敌方配置</div>`;
    html += `<div style="display:flex;gap:16px;">`;
    html += `<div style="flex:0 0 60px;"><div style="font-size:10px;color:var(--text3);margin-bottom:4px;">武将</div>${verticalGeneralsList(enemy.generals)}</div>`;
    html += `<div style="flex:1;"><div style="font-size:10px;color:var(--text3);margin-bottom:4px;">战法</div>${verticalTacticsOnlyList(enemy.tactics)}</div>`;
    html += `<div style="flex:0 0 70px;"><div style="font-size:10px;color:var(--text3);margin-bottom:4px;">阵型</div><div style="font-size:12px;color:var(--text2);">${enemy.formation || '-'}</div></div>`;
    html += `</div></div>`;

    // 克制推荐
    html += `<div style="padding:12px;">`;
    if (counters.length > 0) {
      html += `<div style="font-size:11px;color:var(--green);font-weight:bold;margin-bottom:8px;">✅ 推荐使用（克制该敌方）</div>`;
      counters.slice(0, 3).forEach(c => {
        html += `<div style="background:rgba(81,207,102,0.05);border-radius:6px;padding:10px;margin-bottom:8px;border-left:2px solid var(--green);">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">`;
        html += `<span style="font-weight:bold;font-size:12px;color:var(--blue);">${typeof escHtml === 'function' ? escHtml(c.team) : c.team}</span>`;
        html += `<span style="font-size:11px;color:var(--green);font-weight:bold;">胜率 ${c.winRate.toFixed(0)}%</span>`;
        html += `<span style="font-size:10px;color:var(--text3);">${c.total}场</span>`;
        html += `</div>`;
        // 竖向排列
        html += `<div style="display:flex;gap:16px;">`;
        html += `<div style="flex:0 0 60px;"><div style="font-size:10px;color:var(--text3);margin-bottom:4px;">武将</div>${verticalGeneralsList(c.generals)}</div>`;
        html += `<div style="flex:1;"><div style="font-size:10px;color:var(--text3);margin-bottom:4px;">战法</div>${verticalTacticsOnlyList(c.tactics)}</div>`;
        html += `</div>`;
        html += `</div>`;
      });
    } else {
      html += `<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px;">暂无克制推荐数据</div>`;
    }
    html += `</div></div>`;
  });

  container.innerHTML = html;
}

console.log('[counter-analysis-enhanced] 已加载 ✅');

// 延迟覆盖所有原函数以确保在内联脚本执行后
setTimeout(() => {
  // 覆盖 renderWinRateTable
  if (typeof renderWinRateTable === 'function') {
    window.renderWinRateTable = renderWinRateTableEnhanced;
    console.log('[counter-analysis-enhanced] renderWinRateTable 已覆盖');
  }
  // 覆盖 renderCounterPick
  if (typeof renderCounterPick === 'function') {
    const originalRenderCounterPick = renderCounterPick;
    window.renderCounterPick = renderCounterPickEnhanced;
    console.log('[counter-analysis-enhanced] renderCounterPick 已覆盖');
  }
  // 覆盖 renderEnemyFreq
  if (typeof renderEnemyFreq === 'function') {
    window.renderEnemyFreq = renderEnemyFreqEnhanced;
    console.log('[counter-analysis-enhanced] renderEnemyFreq 已覆盖');
  }

  // 如果数据已加载，刷新所有表格
  if (typeof allRecords !== 'undefined' && allRecords.length > 0) {
    console.log('[counter-analysis-enhanced] 刷新表格...');
    if (typeof renderWinRateTable === 'function') renderWinRateTable();
    if (typeof renderEnemyFreq === 'function') renderEnemyFreq();
    // renderCounterPick 由 renderRestrictCards 调用，不需要单独刷新
  }
}, 200);

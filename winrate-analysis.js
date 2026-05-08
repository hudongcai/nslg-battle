/**
 * 胜率分析 / 克制分析 模块
 * 提供 renderWinRateTable / updateWinRateFilters / renderEnemyFreq 三个核心函数
 * 依赖: data_heroes.js, data_tactics.js, data-system.js (allRecords / currentProjectId)
 */

(function() {
  'use strict';

  // ========== 筛选状态 ==========
  let _winRateFilters = {
    generalFilter: '',      // 武将名筛选
    factionFilter: 'all',   // 阵营筛选
    resultFilter: 'all',    // 战果筛选(胜/负/平)
    sortBy: 'winRate',      // 排序字段
    sortDir: 'desc'         // 排序方向
  };

  /**
   * 更新胜率页面的筛选项下拉框
   */
  window.updateWinRateFilters = function() {
    try {
      const factionSelect = document.getElementById('wrFactionFilter');
      const resultSelect = document.getElementById('wrResultFilter');
      const sortSelect = document.getElementById('wrSortBy');

      if (factionSelect) {
        if (factionSelect.options.length <= 1) {
          FACTIONS.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.key;
            opt.textContent = f.label;
            factionSelect.appendChild(opt);
          });
        }
        factionSelect.value = _winRateFilters.factionFilter;
      }

      if (resultSelect) {
        if (resultSelect.options.length <= 1) {
          [['all','全部'],['win','胜'],['loss','负'],['draw','平']].forEach(([v,l]) => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = l;
            resultSelect.appendChild(opt);
          });
        }
        resultSelect.value = _winRateFilters.resultFilter;
      }

      if (sortSelect) {
        if (sortSelect.options.length <= 1) {
          [['winRate','胜率'],['total','场次'],['avgLoss','平均损兵']].forEach(([v,l]) => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = l;
            sortSelect.appendChild(opt);
          });
        }
        sortSelect.value = _winRateFilters.sortBy;
      }
    } catch(e) {
      console.warn('[updateWinRateFilters] 初始化失败:', e.message);
    }
  };

  /**
   * 从 allRecords 中提取武将阵容数据并计算胜率
   */
  function computeWinRateData(records) {
    if (!records || records.length === 0) return [];

    // 收集每个"我方阵容"(武将组合)的战绩
    const teamStats = {};  // key=teamKey → {wins, losses, draws, total, generals[], tactics[], avgLeftLoss, avgRightLoss}

    for (const rec of records) {
      // 跳过无结果的记录
      if (!rec.result && rec.result !== '胜' && rec.result !== '负' && rec.result !== '平') continue;

      const leftGens = normalizeGenerals(rec.leftGenerals || []);
      const leftTacs = normalizeTactics(rec.leftTactics || []);
      const rightGens = normalizeGenerals(rec.rightGenerals || []);
      const rightTacs = normalizeTactics(rec.rightTactics || []);

      if (leftGens.length === 0) continue;

      const teamKey = getTeamKey(leftGens);

      if (!teamStats[teamKey]) {
        teamStats[teamKey] = {
          generals: leftGens,
          tactics: leftTacs,
          wins: 0,
          losses: 0,
          draws: 0,
          total: 0,
          enemyGeneralsList: [],
          avgLeftLoss: 0,
          avgRightLoss: 0,
          lossSum: 0
        };
      }

      const stat = teamStats[teamKey];
      stat.total++;
      stat.enemyGeneralsList.push(rightGens.join(','));
      
      if (rec.result === '胜' || rec.result === 'win' || rec.result === '胜利') stat.wins++;
      else if (rec.result === '负' || rec.result === 'loss' || rec.result === '失败') stat.losses++;
      else stat.draws++;

      // 损兵统计
      const lLoss = parseFloat(rec.leftLoss) || 0;
      const rLoss = parseFloat(rec.rightLoss) || 0;
      if (lLoss > 0) stat.lossSum += lLoss;
      stat.avgLeftLoss = ((stat.avgLeftLoss * (stat.total - 1)) + lLoss) / stat.total;
      stat.avgRightLoss = ((stat.avgRightLoss * (stat.total - 1)) + rLoss) / stat.total;
    }

    // 转为数组并计算胜率
    const result = Object.entries(teamStats).map(([key, stat]) => ({
      teamKey: key,
      generals: stat.generals,
      tactics: stat.tactics,
      wins: stat.wins,
      losses: stat.losses,
      draws: stat.draws,
      total: stat.total,
      winRate: stat.total > 0 ? Math.round((stat.wins / stat.total) * 10000) / 100 : 0,
      avgLeftLoss: Math.round(stat.avgLeftLoss),
      avgRightLoss: Math.round(stat.avgRightLoss),
      enemyGeneralsList: stat.enemyGeneralsList
    }));

    return result;
  }

  /**
   * 标准化武将数组（去重、过滤空值）
   */
  function normalizeGenerals(generals) {
    if (!Array.isArray(generals)) {
      // 可能是字符串或 undefined/null
      if (typeof generals === 'string' && generals.trim()) {
        return generals.split(/[,，、\/|]/).map(s => s.trim()).filter(Boolean);
      }
      return [];
    }
    return generals.filter(g => g && typeof g === 'string' && g.trim()).map(g => g.trim());
  }

  /**
   * 标准化战法数组
   */
  function normalizeTactics(tactics) {
    if (!Array.isArray(tactics)) return [];
    return tactics.filter(t => t && typeof t === 'string' && t.trim() && t !== '未知').map(t => t.trim());
  }

  /**
   * 渲染胜率表格（核心函数）
   */
  window.renderWinRateTable = function() {
    const container = document.getElementById('winrateTableBody');
    const wrapper = document.getElementById('winrateTableWrap');
    
    if (!wrapper && !container) {
      console.warn('[renderWinRateTable] 找不到容器元素 #winrateTableBody 或 #winrateTableWrap');
      // 尝试动态创建
      const tabContent = document.getElementById('tab-winrate');
      if (tabContent) createWinRateUI(tabContent);
      return;
    }

    // 获取当前项目的所有记录
    const records = typeof loadAllRecords === 'function' ? loadAllRecords() : (window.allRecords || []);

    // 计算数据
    let data = computeWinRateData(records);

    // 应用筛选
    if (_winRateFilters.factionFilter && _winRateFilters.factionFilter !== 'all') {
      data = data.filter(d => {
        return d.generals.some(g => {
          const hero = ALL_HEROES.find(h => h.name === g);
          return hero && hero.faction === _winRateFilters.factionFilter;
        });
      });
    }

    if (_winRateFilters.generalFilter) {
      const kw = _winRateFilters.generalFilter.toLowerCase();
      data = data.filter(d => d.generals.some(g => g.toLowerCase().includes(kw)));
    }

    if (_winRateFilters.resultFilter && _winRateFilters.resultFilter !== 'all') {
      // 简单过滤：只显示有对应结果的数据
      if (_winRateFilters.resultFilter === 'win') data = data.filter(d => d.wins > 0);
      else if (_winRateFilters.resultFilter === 'loss') data = data.filter(d => d.losses > 0);
      else if (_winRateFilters.resultFilter === 'draw') data = data.filter(d => d.draws > 0);
    }

    // 排序
    data.sort((a, b) => {
      let va = a[_winRateFilters.sortBy] || 0;
      let vb = b[_winRateFilters.sortBy] || 0;
      if (typeof va === 'string') va = va.localeCompare ? 0 : va;
      if (typeof vb === 'string') vb = vb.localeCompare ? 0 : vb;
      return _winRateFilters.sortDir === 'desc' ? vb - va : va - vb;
    });

    // 渲染
    if (!container) return;
    
    if (data.length === 0) {
      container.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:40px 0;">暂无战报数据<br><small style="color:#bbb">请先导入战报或在「数据」页面添加记录</small></td></tr>';
      updateWinRateSummary([], records.length);
      return;
    }

    let html = '';
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const wr = d.winRate;
      const wrColor = wr >= 70 ? '#27ae60' : (wr >= 50 ? '#f39c12' : '#e74c3c');
      
      html += '<tr>';
      html += `<td>${i + 1}</td>`;
      html += `<td title="${escHtml(d.teamKey)}">${getTeamDisplay(d.generals)}</td>`;
      html += `<td style="font-size:11px;">${getTacticsDisplay(d.generals, d.tactics)}</td>`;
      html += `<td style="font-weight:bold;color:#4a90d9">${d.total}</td>`;
      html += `<td style="color:${wrColor};font-weight:bold;">${wr}%</td>`;
      html += `<td style="color:#27ae60">胜${d.wins} <span style="color:#e74c3c">负${d.losses}</span> ${d.draws > 0 ? '<span style="color:#999">平'+d.draws+'</span>' : ''}</td>`;
      html += `<td>${d.avgLeftLoss || '-'}/${d.avgRightLoss || '-'}</td>`;
      html += '</tr>';
    }

    container.innerHTML = html;
    updateWinRateSummary(data, records.length);
  };

  /**
   * 渲染敌方出现频率统计
   */
  window.renderEnemyFreq = function() {
    const container = document.getElementById('enemyFreqBody');
    if (!container) return;

    const records = typeof loadAllRecords === 'function' ? loadAllRecords() : (window.allRecords || []);
    
    // 统计每个敌方武将的出现次数和面对时的胜率
    const enemyStats = {};
    let totalBattles = 0;

    for (const rec of records) {
      const rightGens = normalizeGenerals(rec.rightGenerals || []);
      if (rightGens.length === 0) continue;
      totalBattles++;

      for (const enemy of rightGens) {
        if (!enemyStats[enemy]) {
          enemyStats[enemy] = { name: enemy, count: 0, wins: 0, vsTotal: 0 };
        }
        enemyStats[enemy].count++;
        enemyStats[enemy].vsTotal++;
        if (rec.result === '胜' || rec.result === 'win' || rec.result === '胜利') {
          enemyStats[enemy].wins++;
        }
      }
    }

    // 转数组排序
    const sorted = Object.values(enemyStats)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);  // Top 20

    if (sorted.length === 0) {
      container.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:30px 0;">暂无敌方武将数据</td></tr>';
      return;
    }

    let html = '';
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const wr = e.vsTotal > 0 ? Math.round((e.wins / e.vsTotal) * 10000) / 100 : 0;
      const wrColor = wr >= 60 ? '#27ae60' : (wr >= 40 ? '#f39c12' : '#e74c3c');
      
      // 查找克制信息
      const counterInfo = getHeroCounterInfo(e.name);
      const counterHint = counterInfo && counterInfo.weakTo.length > 0 
        ? '<span style="font-size:10px;color:#27ae60;margin-left:6px;">克制:' + counterInfo.weakTo.join(',') + '</span>' 
        : '';
      const weakHint = counterInfo && counterInfo.counters.length > 0
        ? '<span style="font-size:10px;color:#e74c3c;margin-left:4px;">怕:' + counterInfo.counters.join(',') + '</span>'
        : '';

      html += '<tr>';
      html += `<td>${i + 1}</td>`;
      html += `<td><strong>${escHtml(e.name)}</strong>${counterHint}${weakHint}</td>`;
      const hero = ALL_HEROES.find(h => h.name === e.name);
      html += `<td><span style="color:${hero ? (FACTIONS.find(f=>f.key===hero.faction)||{}).color||'#999':'#999'};font-size:11px;">${hero ? hero.faction + '·' + hero.rarity : '?'}</span></td>`;
      html += `<td style="font-weight:bold;color:#4a90d9">${e.count}</td>`;
      html += `<td>${wr}<span style="color:${wrColor};font-size:11px;">%</span></td>`;
      html += '</tr>';
    }

    container.innerHTML = html;
  };

  /**
   * 更新胜率摘要栏
   */
  function updateWinRateSummary(data, rawCount) {
    const el = document.getElementById('winRateSummary');
    if (!el) return;
    
    if (!data || data.length === 0) {
      el.innerHTML = '<span style="color:#999;">暂无统计数据</span>';
      return;
    }

    const totalBattles = data.reduce((s, d) => s + d.total, 0);
    const totalWins = data.reduce((s, d) => s + d.wins, 0);
    const overallWr = totalBattles > 0 ? Math.round((totalWins / totalBattles) * 10000) / 100 : 0;
    const bestTeam = data.sort((a,b) => b.winRate - a.winRate)[0];

    el.innerHTML = `
      <span>共 <b>${rawCount}</b> 条战报</span>
      <span style="margin:0 12px;color:#ddd;">|</span>
      <span><b>${data.length}</b> 套阵容</span>
      <span style="margin:0 12px;color:#ddd;">|</span>
      <span>总胜率: <b style="color:${overallWr>=55?'#27ae60':(overallWr>=45?'#f39c12':'#e74c3c')}">${overallWr}%</b></span>
      ${bestTeam ? `<span style="margin:0 12px;color:#ddd;">|</span><span>最佳: <b style="color:#27ae60;font-size:12px;">${escHtml(bestTeam.teamKey)}</b> (${bestTeam.winRate}%)</span>` : ''}
    `;
  }

  /**
   * 创建胜率分析页面的 UI 结构（如果不存在）
   */
  function createWinRateUI(parent) {
    parent.innerHTML = `
      <div style="padding:16px;">
        <!-- 筛选工具栏 -->
        <div id="wrToolbar" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;padding:12px;background:var(--bg2,#1a1a2e);border-radius:8px;">
          <input type="text" id="wrGeneralFilter" placeholder="搜索武将名..." style="padding:6px 10px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg1,#16213e);color:var(--text,#eee);font-size:13px;width:150px;" oninput="_onWrFilterChange()">
          
          <select id="wrFactionFilter" style="padding:6px 8px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg1,#16213e);color:var(--text,#eee);font-size:13px;" onchange="_onWrFilterChange()"></select>
          
          <select id="wrResultFilter" style="padding:6px 8px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg1,#16213e);color:var(--text,#eee);font-size:13px;" onchange="_onWrFilterChange()"></select>
          
          <select id="wrSortBy" style="padding:6px 8px;border:1px solid var(--border,#333);border-radius:4px;background:var(--bg1,#16213e);color:var(--text,#eee);font-size:13px;" onchange="_onWrSortChange()"></select>
          
          <button onclick="_toggleWrSortDir()" style="padding:6px 12px;border:1px solid var(--border,#333);border-radius:4px;background:var(--accent,#4a90d9);color:#fff;cursor:pointer;font-size:13px;" id="wrSortDirBtn">↓ 降序</button>
        </div>

        <!-- 摘要 -->
        <div id="winRateSummary" style="margin-bottom:14px;padding:10px 14px;background:rgba(74,144,217,0.08);border-radius:6px;border-left:3px solid #4a90d9;font-size:13px;"></div>

        <!-- 双列布局 -->
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <!-- 左：胜率表格 -->
          <div style="flex:2;min-width:400px;">
            <h4 style="margin:0 0 10px;color:var(--text,#eee);font-size:15px;">📊 阵容胜率排行</h4>
            <div style="overflow-x:auto;border:1px solid var(--border,#333);border-radius:8px;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="background:var(--bg2,#1a1a2e);">
                    <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">#</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">我方武将</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">搭配战法</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">场次</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">胜率</th>
                    <th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border,#333);color:#aaa;">胜负</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">我方/敌方损兵</th>
                  </tr>
                </thead>
                <tbody id="winrateTableBody"></tbody>
              </table>
            </div>
          </div>

          <!-- 右：敌方频率 -->
          <div style="flex:1;min-width:300px;">
            <h4 style="margin:0 0 10px;color:var(--text,#eee);font-size:15px;">⚔️ 敌方武将 TOP 20</h4>
            <div style="overflow-x:auto;border:1px solid var(--border,#333);border-radius:8px;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="background:var(--bg2,#1a1a2e);">
                    <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">#</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">武将</th>
                    <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">阵营</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">出场</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">对阵胜率</th>
                  </tr>
                </thead>
                <tbody id="enemyFreqBody"></tbody>
              </table>
            </div>
            
            <!-- 克制提示 -->
            <div id="counterTipBox" style="margin-top:14px;padding:12px;background:rgba(155,89,182,0.08);border-radius:6px;border-left:3px solid #9b59b6;display:none;">
              <div style="font-weight:bold;color:#bb8fce;font-size:13px;margin-bottom:6px;">🎯 克制建议</div>
              <div id="counterTipContent" style="font-size:12px;color:#ccc;line-height:1.6;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // 初始化后重新渲染
    updateWinRateFilters();
    renderWinRateTable();
    renderEnemyFreq();
  }

  // ========== 全局事件处理函数 ==========
  
  window._onWrFilterChange = function() {
    _winRateFilters.generalFilter = (document.getElementById('wrGeneralFilter')?.value || '').trim();
    _winRateFilters.factionFilter = document.getElementById('wrFactionFilter')?.value || 'all';
    _winRateFilters.resultFilter = document.getElementById('wrResultFilter')?.value || 'all';
    renderWinRateTable();
  };

  window._onWrSortChange = function() {
    _winRateFilters.sortBy = document.getElementById('wrSortBy')?.value || 'winRate';
    renderWinRateTable();
  };

  window._toggleWrSortDir = function() {
    _winRateFilters.sortDir = _winRateFilters.sortDir === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('wrSortDirBtn');
    if (btn) btn.textContent = (_winRateFilters.sortDir === 'desc' ? '↓ 降序' : '↑ 升序');
    renderWinRateTable();
  };

  // ========== 辅助函数（兼容 data-system.js） ==========
  
  // 如果 data-system.js 已定义这些函数则跳过
  if (typeof escHtml !== 'function') {
    window.escHtml = function(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };
  }
  if (typeof getTeamKey !== 'function') {
    window.getTeamKey = function(generals) {
      if (!generals || generals.length === 0) return '未知';
      return generals.filter(g => g && g.trim()).map(g => g.trim()).sort().join(',') || '未知';
    };
  }
  if (typeof getTeamDisplay !== 'function') {
    window.getTeamDisplay = function(generals) {
      if (!generals || generators.length === 0) return '-';
      return generals.slice(0, 3).map(g => escHtml(g)).join('<br>');
    };
  }
  if (typeof getTacticsDisplay !== 'function') {
    window.getTacticsDisplay = function(generals, tactics) {
      if (!generals || generals.length === 0) return '-';
      let html = '<div style="display:flex;flex-direction:column;gap:3px;">';
      for (let i = 0; i < Math.min(3, generals.length); i++) {
        const base = i * 3;
        const fm = tactics?.[base] || '';
        const t1 = tactics?.[base + 1] || '';
        const t2 = tactics?.[base + 2] || '';
        const parts = [fm, t1, t2].filter(t => t && t !== '未知');
        html += `<div style="display:flex;align-items:baseline;gap:4px;white-space:nowrap;"><span style="color:var(--blue,#4a90d9);font-weight:bold;font-size:11px;min-width:40px;">${escHtml(generals[i])}</span><span style="color:var(--text2,#888);font-size:10px;">${parts.length ? parts.map(t => escHtml(t)).join(' / ') : '-'}</span></div>`;
      }
      html += '</div>';
      return html;
    };
  }

  console.log('[winrate-analysis] 模块已加载 ✅ | 提供: renderWinRateTable, updateWinRateFilters, renderEnemyFreq');

})();

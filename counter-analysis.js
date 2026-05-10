/**
 * 克制分析模块
 * 包含三个核心功能：
 * 1. 克制关系分析 - 统计相同对战队伍的胜率和战损
 * 2. 敌方高频队伍 - 统计敌方队伍出现频率 TOP30
 * 3. 高频克制推荐 - 针对敌方高频队伍推荐克制队伍
 */

(function() {
  'use strict';

  // ========== 数据结构定义 ==========
  
  /**
   * 生成队伍唯一标识
   * 武将排序 + 阵型 + 战法排序（无顺序要求）
   */
  function getTeamKey(generals, tactics, formation) {
    const gens = normalizeGenerals(generals).sort().join('|');
    const tacs = normalizeTactics(tactics).sort().join('|');
    const form = (formation || '').trim();
    return `${gens}@${form}#${tacs}`;
  }

  /**
   * 生成精简的队伍显示键（仅武将）
   */
  function getTeamDisplayKey(generals) {
    return normalizeGenerals(generals).sort().join('、');
  }

  /**
   * 标准化武将数组
   */
  function normalizeGenerals(generals) {
    if (!generals) return [];
    if (typeof generals === 'string') {
      return generals.split(/[,，、\/|]/).map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(generals)) {
      return generals.filter(g => g && typeof g === 'string' && g.trim()).map(g => g.trim());
    }
    return [];
  }

  /**
   * 标准化战法数组
   */
  function normalizeTactics(tactics) {
    if (!tactics) return [];
    if (typeof tactics === 'string') {
      return tactics.split(/[,，、\/|]/).map(s => s.trim()).filter(t => t && t !== '未知');
    }
    if (Array.isArray(tactics)) {
      return tactics.filter(t => t && typeof t === 'string' && t.trim() && t !== '未知').map(t => t.trim());
    }
    return [];
  }

  /**
   * HTML 转义
   */
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ========== 1. 克制关系分析 ==========
  
  /**
   * 分析克制关系数据
   * 找出双方武将相同、阵型相同、战法相同的对战记录，统计胜率和战损
   */
  function analyzeCounterRelationship(records) {
    if (!records || !Array.isArray(records) || records.length === 0) return [];

    // 按对战组合分组：key = 左队key + "VS" + 右队key
    const battleGroups = {};

    for (const rec of records) {
      const leftGens = normalizeGenerals(rec.leftGenerals || rec.left_generals || []);
      const leftTacs = normalizeTactics(rec.leftTactics || rec.left_tactics || []);
      const leftForm = rec.leftFormation || rec.left_formation || '';
      
      const rightGens = normalizeGenerals(rec.rightGenerals || rec.right_generals || []);
      const rightTacs = normalizeTactics(rec.rightTactics || rec.right_tactics || []);
      const rightForm = rec.rightFormation || rec.right_formation || '';

      if (leftGens.length < 1 || rightGens.length < 1) continue;

      const leftKey = getTeamKey(leftGens, leftTacs, leftForm);
      const rightKey = getTeamKey(rightGens, rightTacs, rightForm);

      // 创建统一的对战键（确保相同对战只算一次）
      const battleKey = leftKey < rightKey ? `${leftKey}VS${rightKey}` : `${rightKey}VS${leftKey}`;
      const isLeftFirst = leftKey < rightKey;

      if (!battleGroups[battleKey]) {
        battleGroups[battleKey] = {
          leftKey: isLeftFirst ? leftKey : rightKey,
          rightKey: isLeftFirst ? rightKey : leftKey,
          leftGenerals: isLeftFirst ? leftGens : rightGens,
          leftTactics: isLeftFirst ? leftTacs : rightTacs,
          leftFormation: isLeftFirst ? leftForm : rightForm,
          rightGenerals: isLeftFirst ? rightGens : leftGens,
          rightTactics: isLeftFirst ? rightTacs : leftTacs,
          rightFormation: isLeftFirst ? rightForm : leftForm,
          leftWins: 0,   // 左侧队伍获胜次数
          rightWins: 0,  // 右侧队伍获胜次数
          draws: 0,      // 平局次数
          leftLossSum: 0,
          rightLossSum: 0,
          totalBattles: 0,
          records: []
        };
      }

      const group = battleGroups[battleKey];
      group.totalBattles++;
      group.records.push(rec);

      const leftLoss = parseFloat(rec.leftLoss || rec.left_loss || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);

      if (isLeftFirst) {
        group.leftLossSum += leftLoss;
        group.rightLossSum += rightLoss;
        if (rec.result === '胜' || rec.result === 'win' || rec.result === '胜利') {
          group.leftWins++;
        } else if (rec.result === '负' || rec.result === 'loss' || rec.result === '失败') {
          group.rightWins++;
        } else {
          group.draws++;
        }
      } else {
        group.leftLossSum += rightLoss;
        group.rightLossSum += leftLoss;
        if (rec.result === '胜' || rec.result === 'win' || rec.result === '胜利') {
          group.rightWins++;
        } else if (rec.result === '负' || rec.result === 'loss' || rec.result === '失败') {
          group.leftWins++;
        } else {
          group.draws++;
        }
      }
    }

    // 计算统计数据并排序
    const results = Object.values(battleGroups).map(group => {
      const leftWinRate = group.totalBattles > 0 ? Math.round((group.leftWins / group.totalBattles) * 10000) / 100 : 0;
      const rightWinRate = group.totalBattles > 0 ? Math.round((group.rightWins / group.totalBattles) * 10000) / 100 : 0;
      const leftAvgLoss = group.totalBattles > 0 ? Math.round(group.leftLossSum / group.totalBattles) : 0;
      const rightAvgLoss = group.totalBattles > 0 ? Math.round(group.rightLossSum / group.totalBattles) : 0;
      const lossRate = rightAvgLoss > 0 ? Math.round((leftAvgLoss / rightAvgLoss) * 10000) / 100 : 0;

      // 判断哪方胜率更高
      let betterSide = 'left';
      if (rightWinRate > leftWinRate) {
        betterSide = 'right';
      } else if (rightWinRate === leftWinRate) {
        // 胜率相同时，战损低的更好
        betterSide = leftAvgLoss < rightAvgLoss ? 'left' : 'right';
      }

      return {
        ...group,
        leftWinRate,
        rightWinRate,
        leftAvgLoss,
        rightAvgLoss,
        lossRate,
        betterSide,
        displayKey: getTeamDisplayKey(group.leftGenerals) + ' VS ' + getTeamDisplayKey(group.rightGenerals)
      };
    });

    // 按对战次数降序排序
    return results.sort((a, b) => b.totalBattles - a.totalBattles);
  }

  /**
   * 渲染克制关系分析表格
   */
  window.renderCounterAnalysis = function() {
    const container = document.getElementById('counterAnalysisBody');
    if (!container) return;

    const records = typeof loadAllRecords === 'function' ? loadAllRecords() : (window.allRecords || []);
    const data = analyzeCounterRelationship(records);

    if (data.length === 0) {
      container.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#999;padding:40px 0;">暂无克制关系数据<br><small style="color:#bbb">需要至少两条相同对战组合的战报</small></td></tr>';
      return;
    }

    let html = '';
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const isLeftBetter = d.betterSide === 'left';

      html += '<tr>';
      html += `<td style="font-weight:bold;color:#4a90d9;">${i + 1}</td>`;
      
      // 胜率高的队伍在左侧
      if (isLeftBetter) {
        html += renderTeamCell(d.leftGenerals, d.leftTactics, d.leftFormation, true);
        html += renderTeamCell(d.rightGenerals, d.rightTactics, d.rightFormation, false);
        html += `<td style="text-align:right;font-weight:bold;">${d.leftWins}</td>`;
        html += `<td style="text-align:right;color:#27ae60;font-weight:bold;">${d.leftWinRate}%</td>`;
        html += `<td style="text-align:right;color:#4a90d9;">${d.lossRate}%</td>`;
      } else {
        html += renderTeamCell(d.rightGenerals, d.rightTactics, d.rightFormation, true);
        html += renderTeamCell(d.leftGenerals, d.leftTactics, d.leftFormation, false);
        html += `<td style="text-align:right;font-weight:bold;">${d.rightWins}</td>`;
        html += `<td style="text-align:right;color:#27ae60;font-weight:bold;">${d.rightWinRate}%</td>`;
        html += `<td style="text-align:right;color:#4a90d9;">${(d.rightAvgLoss > 0 ? Math.round((d.leftAvgLoss / d.rightAvgLoss) * 10000) / 100 : 0)}%</td>`;
      }
      
      html += `<td style="text-align:right;font-weight:bold;">${d.totalBattles}</td>`;
      html += `<td style="text-align:right;">${isLeftBetter ? d.leftAvgLoss : d.rightAvgLoss}</td>`;
      html += `<td style="text-align:right;">${isLeftBetter ? d.rightAvgLoss : d.leftAvgLoss}</td>`;
      html += `<td><button onclick="showRecordSource(${i})" style="padding:4px 8px;border:none;border-radius:4px;background:#4a90d9;color:white;font-size:11px;cursor:pointer;">溯源</button></td>`;
      html += '</tr>';
    }

    container.innerHTML = html;
  };

  /**
   * 渲染队伍单元格
   */
  function renderTeamCell(generals, tactics, formation, isBetter) {
    const genHtml = generals.map(g => `<div style="font-weight:bold;color:${getHeroColor(g)};">${escHtml(g)}</div>`).join('');
    const tacHtml = tactics.slice(0, 9).map((t, idx) => {
      const color = idx < 3 ? '#f39c12' : '#9b59b6';
      return `<span style="color:${color};font-size:10px;">${escHtml(t)}</span>`;
    }).join(' / ');
    
    return `
      <td style="padding:8px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div>${genHtml}</div>
          <div style="font-size:11px;color:#888;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(tacHtml)}">${tacHtml}</div>
          <div style="font-size:10px;color:#666;">阵: ${escHtml(formation || '-')}</div>
        </div>
      </td>
    `;
  }

  /**
   * 获取武将颜色（基于阵营）
   */
  function getHeroColor(heroName) {
    if (!window.ALL_HEROES) return '#eee';
    const hero = ALL_HEROES.find(h => h.name === heroName);
    if (!hero) return '#eee';
    const faction = (window.FACTIONS || []).find(f => f.key === hero.faction);
    return faction ? faction.color : '#eee';
  }

  // ========== 2. 敌方高频队伍 ==========
  
  /**
   * 分析敌方高频队伍
   */
  function analyzeEnemyHighFreq(records) {
    if (!records || !Array.isArray(records) || records.length === 0) return [];

    const enemyStats = {};

    for (const rec of records) {
      const rightGens = normalizeGenerals(rec.rightGenerals || rec.right_generals || []);
      const rightTacs = normalizeTactics(rec.rightTactics || rec.right_tactics || []);
      const rightForm = rec.rightFormation || rec.right_formation || '';

      if (rightGens.length === 0) continue;

      const teamKey = getTeamKey(rightGens, rightTacs, rightForm);

      if (!enemyStats[teamKey]) {
        enemyStats[teamKey] = {
          generals: rightGens,
          tactics: rightTacs,
          formation: rightForm,
          count: 0,
          vsWins: 0,  // 我方战胜该队伍的次数
          vsTotal: 0
        };
      }

      enemyStats[teamKey].count++;
      enemyStats[teamKey].vsTotal++;
      if (rec.result === '胜' || rec.result === 'win' || rec.result === '胜利') {
        enemyStats[teamKey].vsWins++;
      }
    }

    const results = Object.values(enemyStats).map(stat => ({
      ...stat,
      vsWinRate: stat.vsTotal > 0 ? Math.round((stat.vsWins / stat.vsTotal) * 10000) / 100 : 0,
      displayKey: getTeamDisplayKey(stat.generals)
    }));

    return results.sort((a, b) => b.count - a.count).slice(0, 30);
  }

  /**
   * 渲染敌方高频队伍列表
   */
  window.renderEnemyHighFreq = function() {
    const container = document.getElementById('enemyHighFreqBody');
    if (!container) return;

    const records = typeof loadAllRecords === 'function' ? loadAllRecords() : (window.allRecords || []);
    const data = analyzeEnemyHighFreq(records);

    if (data.length === 0) {
      container.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:40px 0;">暂无敌方队伍数据</td></tr>';
      return;
    }

    let html = '';
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const wrColor = d.vsWinRate >= 60 ? '#27ae60' : (d.vsWinRate >= 40 ? '#f39c12' : '#e74c3c');

      html += '<tr>';
      html += `<td style="font-weight:bold;color:#4a90d9;">${i + 1}</td>`;
      html += `<td>${d.generals.map(g => `<div style="color:${getHeroColor(g)};">${escHtml(g)}</div>`).join('')}</td>`;
      html += `<td style="font-size:11px;color:#888;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(d.tactics.join(' / '))}">${d.tactics.slice(0, 6).map(t => escHtml(t)).join(' / ')}</td>`;
      html += `<td style="font-size:11px;color:#666;">${escHtml(d.formation || '-')}</td>`;
      html += `<td style="text-align:right;font-weight:bold;">${d.count}</td>`;
      html += `<td style="text-align:right;color:${wrColor};">${d.vsWinRate}%</td>`;
      html += '</tr>';
    }

    container.innerHTML = html;
  };

  // ========== 3. 高频克制推荐 ==========
  
  /**
   * 分析高频克制推荐
   */
  function analyzeCounterRecommendations(records) {
    if (!records || !Array.isArray(records) || records.length === 0) return [];

    // 获取敌方高频队伍
    const enemyHighFreq = analyzeEnemyHighFreq(records);
    
    // 构建对战矩阵
    const counterMatrix = {};

    for (const rec of records) {
      const leftGens = normalizeGenerals(rec.leftGenerals || rec.left_generals || []);
      const leftTacs = normalizeTactics(rec.leftTactics || rec.left_tactics || []);
      const leftForm = rec.leftFormation || rec.left_formation || '';
      
      const rightGens = normalizeGenerals(rec.rightGenerals || rec.right_generals || []);
      const rightTacs = normalizeTactics(rec.rightTactics || rec.right_tactics || []);
      const rightForm = rec.rightFormation || rec.right_formation || '';

      if (leftGens.length === 0 || rightGens.length === 0) continue;

      const leftKey = getTeamKey(leftGens, leftTacs, leftForm);
      const rightKey = getTeamKey(rightGens, rightTacs, rightForm);

      if (!counterMatrix[rightKey]) {
        counterMatrix[rightKey] = {};
      }

      if (!counterMatrix[rightKey][leftKey]) {
        counterMatrix[rightKey][leftKey] = {
          counterKey: leftKey,
          counterGenerals: leftGens,
          counterTactics: leftTacs,
          counterFormation: leftForm,
          enemyKey: rightKey,
          enemyGenerals: rightGens,
          enemyTactics: rightTacs,
          enemyFormation: rightForm,
          wins: 0,
          losses: 0,
          draws: 0,
          total: 0,
          leftLossSum: 0,
          rightLossSum: 0
        };
      }

      const stat = counterMatrix[rightKey][leftKey];
      stat.total++;
      
      const leftLoss = parseFloat(rec.leftLoss || rec.left_loss || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);
      stat.leftLossSum += leftLoss;
      stat.rightLossSum += rightLoss;

      if (rec.result === '胜' || rec.result === 'win' || rec.result === '胜利') {
        stat.wins++;
      } else if (rec.result === '负' || rec.result === 'loss' || rec.result === '失败') {
        stat.losses++;
      } else {
        stat.draws++;
      }
    }

    // 生成推荐列表
    const recommendations = [];

    for (const enemy of enemyHighFreq) {
      const enemyKey = getTeamKey(enemy.generals, enemy.tactics, enemy.formation);
      const counters = counterMatrix[enemyKey];

      if (!counters) continue;

      // 找到胜率高于50%的克制队伍
      const goodCounters = Object.values(counters).filter(c => {
        const winRate = c.total > 0 ? (c.wins / c.total) * 100 : 0;
        return winRate > 50 && c.total >= 2; // 至少对战2次且胜率>50%
      }).map(c => ({
        ...c,
        winRate: c.total > 0 ? Math.round((c.wins / c.total) * 10000) / 100 : 0,
        avgLeftLoss: c.total > 0 ? Math.round(c.leftLossSum / c.total) : 0,
        avgRightLoss: c.total > 0 ? Math.round(c.rightLossSum / c.total) : 0,
        lossRate: c.total > 0 && c.rightLossSum > 0 ? Math.round((c.leftLossSum / c.rightLossSum) * 10000) / 100 : 0
      })).sort((a, b) => b.winRate - a.winRate);

      if (goodCounters.length > 0) {
        recommendations.push({
          enemy,
          counters: goodCounters.slice(0, 5) // 每个敌方队伍最多推荐5个克制队伍
        });
      }
    }

    return recommendations;
  }

  /**
   * 渲染高频克制推荐
   */
  window.renderCounterRecommendations = function() {
    const container = document.getElementById('counterRecommendations');
    if (!container) return;

    const records = typeof loadAllRecords === 'function' ? loadAllRecords() : (window.allRecords || []);
    const data = analyzeCounterRecommendations(records);

    if (data.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:#999;padding:40px 0;">暂无克制推荐数据<br><small style="color:#bbb">需要足够的战报数据才能生成克制推荐</small></div>';
      return;
    }

    let html = '';
    for (const item of data) {
      html += `
        <div style="background:var(--bg2,#1a1a2e);border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid var(--border,#333);">
          <div style="display:flex;gap:20px;align-items:flex-start;">
            <!-- 敌方队伍 -->
            <div style="flex:1;min-width:200px;">
              <div style="background:#9b59b6;border-radius:8px;padding:12px;">
                <div style="font-size:12px;color:#bb8fce;font-weight:bold;margin-bottom:8px;">👹 敌方高频队伍</div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                  ${item.enemy.generals.map(g => `<div style="font-weight:bold;color:${getHeroColor(g)};">${escHtml(g)}</div>`).join('')}
                </div>
                <div style="font-size:11px;color:#888;margin-top:6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${item.enemy.tactics.slice(0, 9).map(t => escHtml(t)).join(' / ')}
                </div>
                <div style="font-size:10px;color:#666;margin-top:4px;">阵: ${escHtml(item.enemy.formation || '-')}</div>
                <div style="font-size:11px;color:#f39c12;margin-top:6px;">出场: ${item.enemy.count}次</div>
              </div>
            </div>

            <!-- VS 标识 -->
            <div style="display:flex;align-items:center;justify-content:center;width:40px;">
              <div style="font-size:24px;color:#e74c3c;font-weight:bold;">VS</div>
            </div>

            <!-- 克制队伍列表 -->
            <div style="flex:2;">
              <div style="font-size:12px;color:#27ae60;font-weight:bold;margin-bottom:8px;">🛡️ 克制队伍推荐</div>
              <div style="display:flex;flex-wrap:gap:10px;flex-direction:column;gap:10px;">
                ${item.counters.map((counter, idx) => `
                  <div style="background:#27ae60;border-radius:8px;padding:12px;">
                    <div style="display:flex;justify-content-between;align-items-start;margin-bottom:8px;">
                      <div style="display:flex;flex-direction:column;gap:4px;">
                        ${counter.counterGenerals.map(g => `<div style="font-weight:bold;color:${getHeroColor(g)};">${escHtml(g)}</div>`).join('')}
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:14px;font-weight:bold;color:white;">${counter.winRate}%</div>
                        <div style="font-size:10px;color:#88ddaa;">${counter.total}场</div>
                      </div>
                    </div>
                    <div style="font-size:11px;color:#888;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                      ${counter.counterTactics.slice(0, 9).map(t => escHtml(t)).join(' / ')}
                    </div>
                    <div style="font-size:10px;color:#666;margin-top:4px;">
                      阵: ${escHtml(counter.counterFormation || '-')} | 战损率: ${counter.lossRate}%
                    </div>
                    <button onclick="showRecordSource(${idx})" style="margin-top:8px;padding:4px 8px;border:none;border-radius:4px;background:rgba(255,255,255,0.2);color:white;font-size:11px;cursor:pointer;">图片溯源</button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  };

  /**
   * 创建克制分析页面 UI
   */
  window.createCounterAnalysisUI = function(parent) {
    parent.innerHTML = `
      <div style="padding:16px;">
        <!-- 标签页切换 -->
        <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border,#333);">
          <button onclick="switchCounterTab('relationship')" id="tabRelBtn" style="padding:8px 16px;border:none;border-radius:4px 4px 0 0;background:#4a90d9;color:white;font-weight:bold;">⚔️ 克制关系分析</button>
          <button onclick="switchCounterTab('enemy')" id="tabEnemyBtn" style="padding:8px 16px;border:none;border-radius:4px 4px 0 0;background:var(--bg2,#1a1a2e);color:#aaa;">👹 敌方高频队伍</button>
          <button onclick="switchCounterTab('recommend')" id="tabRecBtn" style="padding:8px 16px;border:none;border-radius:4px 4px 0 0;background:var(--bg2,#1a1a2e);color:#aaa;">🎯 高频克制推荐</button>
        </div>

        <!-- 克制关系分析 -->
        <div id="counterTabRelationship" style="display:block;">
          <div style="margin-bottom:12px;color:#888;font-size:13px;">
            💡 分析相同对战组合的胜率与战损，胜率高/战损低的队伍显示在左侧
          </div>
          <div style="overflow-x:auto;border:1px solid var(--border,#333);border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:var(--bg2,#1a1a2e);">
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;width:40px;">#</th>
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">胜率高队伍</th>
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">对手队伍</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">获胜次数</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">胜率</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">战损率</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">对战次数</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">左队平均战损</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">右队平均战损</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border,#333);color:#aaa;">操作</th>
                </tr>
              </thead>
              <tbody id="counterAnalysisBody"></tbody>
            </table>
          </div>
        </div>

        <!-- 敌方高频队伍 -->
        <div id="counterTabEnemy" style="display:none;">
          <div style="margin-bottom:12px;color:#888;font-size:13px;">
            💡 统计敌方队伍出现频率 TOP30（武将相同且战法相同视为同一队伍）
          </div>
          <div style="overflow-x:auto;border:1px solid var(--border,#333);border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:var(--bg2,#1a1a2e);">
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;width:40px;">#</th>
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">武将</th>
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">战法</th>
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);color:#aaa;">阵型</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">出现次数</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border,#333);color:#aaa;">我方胜率</th>
                </tr>
              </thead>
              <tbody id="enemyHighFreqBody"></tbody>
            </table>
          </div>
        </div>

        <!-- 高频克制推荐 -->
        <div id="counterTabRecommend" style="display:none;">
          <div style="margin-bottom:12px;color:#888;font-size:13px;">
            💡 针对敌方高频队伍，推荐胜率>50%的克制队伍（至少对战2次）
          </div>
          <div id="counterRecommendations"></div>
        </div>
      </div>
    `;

    // 绑定事件
    switchCounterTab('relationship');
  };

  /**
   * 切换标签页
   */
  window.switchCounterTab = function(tabName) {
    const tabs = ['relationship', 'enemy', 'recommend'];
    
    tabs.forEach(tab => {
      const el = document.getElementById(`counterTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
      const btn = document.getElementById(`tab${tab === 'relationship' ? 'Rel' : tab === 'enemy' ? 'Enemy' : 'Rec'}Btn`);
      if (el && btn) {
        if (tab === tabName) {
          el.style.display = 'block';
          btn.style.background = '#4a90d9';
          btn.style.color = 'white';
        } else {
          el.style.display = 'none';
          btn.style.background = 'var(--bg2,#1a1a2e)';
          btn.style.color = '#aaa';
        }
      }
    });

    // 渲染对应内容
    if (tabName === 'relationship') renderCounterAnalysis();
    else if (tabName === 'enemy') renderEnemyHighFreq();
    else if (tabName === 'recommend') renderCounterRecommendations();
  };

  /**
   * 显示记录溯源（占位函数）
   */
  window.showRecordSource = function(index) {
    alert(`显示第 ${index + 1} 条记录的图片溯源（功能待实现）`);
  };

  console.log('[counter-analysis] 模块已加载 ✅ | 提供: renderCounterAnalysis, renderEnemyHighFreq, renderCounterRecommendations, createCounterAnalysisUI, switchCounterTab');

})();
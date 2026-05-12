/**
 * 克制分析模块 v202605120002
 * 1. 克制关系分析  2. 敌方高频队伍  3. 高频克制推荐
 */
(function () {
  'use strict';

  // ==================== 工具函数 ====================

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function normalizeArr(val, excludes) {
    excludes = excludes || [];
    if (!val) return [];
    let arr;
    if (Array.isArray(val)) {
      arr = val;
    } else if (typeof val === 'string') {
      try {
        const p = JSON.parse(val);
        arr = Array.isArray(p) ? p : val.split(/[,，、\/|]/);
      } catch (e) {
        arr = val.split(/[,，、\/|]/);
      }
    } else return [];
    return arr.map(s => String(s).trim()).filter(s => s && !excludes.includes(s));
  }

  const normGens = v => normalizeArr(v);
  const normTacs = v => normalizeArr(v, ['未知']);

  function teamKey(gens, tacs, form) {
    return normGens(gens).sort().join('|')
      + '@' + (form || '').trim()
      + '#' + normTacs(tacs).sort().join('|');
  }

  function winner(result) {
    if (/^(胜|win|胜利)$/.test(result)) return 'left';
    if (/^(败|负|loss|失败)$/.test(result)) return 'right';
    return 'draw';
  }

  function records() { return window.allRecords || []; }

  function heroColor(name) {
    const h = (window.ALL_HEROES || []).find(x => x.name === name);
    if (!h) return '#ccc';
    const f = (window.FACTIONS || []).find(x => x.key === h.faction);
    return f ? f.color : '#ccc';
  }

  async function ensureRecords() {
    if (typeof loadAllRecords === 'function') {
      try { await loadAllRecords(); } catch (e) {}
    }
  }

  // ==================== 渲染工具 ====================

  // 武将名列表（单行 nowrap，防止撑破表格）
  function gensHtml(generals) {
    const gens = normGens(generals);
    if (!gens.length) return '<span class="ca-dim">—</span>';
    return gens.map(g => `<b style="color:${heroColor(g)}">${escHtml(g)}</b>`)
               .join('<span class="ca-dot">·</span>');
  }

  // 战法标签
  function tacsHtml(tactics) {
    const tacs = normTacs(tactics);
    if (!tacs.length) return '';
    return tacs.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('');
  }

  // 阵型标签
  function formHtml(formation) {
    const f = (formation || '').trim();
    return f ? `<span class="ca-form-badge">${escHtml(f)}</span>` : '<span class="ca-dim">—</span>';
  }

  // 两行队伍芯片：第一行武将+阵型，第二行战法，整体加盒子强关联
  function teamChip(generals, tactics, formation, isWinner) {
    const gens = normGens(generals);
    const tacs = normTacs(tactics);
    const form = (formation || '').trim();

    const line1 = gens.length
      ? gens.map(g => `<b style="color:${heroColor(g)}">${escHtml(g)}</b>`)
            .join('<span class="ca-dot">·</span>')
      : '<span class="ca-dim">—</span>';

    const tacRow = tacs.length
      ? `<div class="ca-tacs">${tacs.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')}</div>`
      : '';

    const formTag = form ? `<span class="ca-form-badge">${escHtml(form)}</span>` : '';

    return `<div class="ca-chip${isWinner ? ' ca-chip-winner' : ''}">
      <div class="ca-chip-row1">${line1}${formTag ? `<span class="ca-chip-sep"></span>${formTag}` : ''}</div>
      ${tacRow}
    </div>`;
  }

  // ==================== 图片溯源 ====================

  function showImageSource(recs) {
    const imgs = recs.map(r => r.imageBase64 || r.imageData).filter(Boolean);
    if (!imgs.length) { alert('该战报组合暂无图片数据'); return; }
    let modal = document.getElementById('_caModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = '_caModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;overflow-y:auto;padding:48px 20px 20px;display:flex;flex-direction:column;align-items:center;gap:16px;';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'position:fixed;top:14px;right:16px;background:#e74c3c;color:#fff;border:none;border-radius:50%;width:34px;height:34px;font-size:16px;cursor:pointer;z-index:10000;';
    close.onclick = () => modal.remove();
    modal.appendChild(close);
    imgs.forEach((src, i) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div style="color:#888;font-size:11px;margin-bottom:4px;">第 ${i+1}/${imgs.length} 张</div>
        <img src="${escHtml(src)}" style="max-width:min(860px,90vw);border-radius:8px;border:1px solid #444;">`;
      modal.appendChild(wrap);
    });
    document.body.appendChild(modal);
  }

  // ==================== 数据分析 ====================

  function analyzeCounter(recs) {
    const groups = {};
    for (const rec of recs) {
      const lg = normGens(rec.leftGenerals  || rec.left_generals);
      const lt = normTacs(rec.leftTactics   || rec.left_tactics);
      const lf = rec.leftFormation  || rec.left_formation  || '';
      const rg = normGens(rec.rightGenerals || rec.right_generals);
      const rt = normTacs(rec.rightTactics  || rec.right_tactics);
      const rf = rec.rightFormation || rec.right_formation || '';
      if (!lg.length || !rg.length) continue;
      const lk = teamKey(lg, lt, lf);
      const rk = teamKey(rg, rt, rf);
      const aIsLeft = lk <= rk;
      const bk = aIsLeft ? `${lk}VS${rk}` : `${rk}VS${lk}`;
      if (!groups[bk]) {
        groups[bk] = {
          a: { generals: aIsLeft ? lg : rg, tactics: aIsLeft ? lt : rt, formation: aIsLeft ? lf : rf },
          b: { generals: aIsLeft ? rg : lg, tactics: aIsLeft ? rt : lt, formation: aIsLeft ? rf : lf },
          aW: 0, bW: 0, draws: 0, aLoss: 0, bLoss: 0, total: 0, records: []
        };
      }
      const g = groups[bk];
      g.total++;
      g.records.push(rec);
      const w  = winner(rec.result);
      const ll = parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      const rl = parseFloat(rec.rightLoss || rec.right_loss || 0);
      if (aIsLeft) {
        g.aLoss += ll; g.bLoss += rl;
        if (w === 'left') g.aW++; else if (w === 'right') g.bW++; else g.draws++;
      } else {
        g.aLoss += rl; g.bLoss += ll;
        if (w === 'right') g.aW++; else if (w === 'left') g.bW++; else g.draws++;
      }
    }
    return Object.values(groups)
      .filter(g => g.total >= 1)
      .map(g => {
        const aWR = g.total ? g.aW / g.total * 100 : 0;
        const bWR = g.total ? g.bW / g.total * 100 : 0;
        const aAvg = g.total ? Math.round(g.aLoss / g.total) : 0;
        const bAvg = g.total ? Math.round(g.bLoss / g.total) : 0;
        const aWins = aWR > bWR || (aWR === bWR && aAvg <= bAvg);
        const left  = aWins ? g.a : g.b;
        const right = aWins ? g.b : g.a;
        const lW    = aWins ? g.aW : g.bW;
        const lWR   = Math.round((aWins ? aWR : bWR) * 10) / 10;
        const lAvg  = aWins ? aAvg : bAvg;
        const rAvg  = aWins ? bAvg : aAvg;
        return {
          left, right,
          leftWins: lW, draws: g.draws,
          leftWR: lWR,
          leftAvgLoss: lAvg, rightAvgLoss: rAvg,
          lossRate: rAvg > 0 ? Math.round(lAvg / rAvg * 100) : 0,
          total: g.total, records: g.records
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  function analyzeEnemyFreq(recs) {
    const stats = {};
    for (const rec of recs) {
      const rg = normGens(rec.rightGenerals || rec.right_generals);
      const rt = normTacs(rec.rightTactics  || rec.right_tactics);
      const rf = rec.rightFormation || rec.right_formation || '';
      if (!rg.length) continue;
      const k = teamKey(rg, rt, rf);
      if (!stats[k]) stats[k] = { generals: rg, tactics: rt, formation: rf, count: 0 };
      stats[k].count++;
    }
    return Object.values(stats).sort((a, b) => b.count - a.count).slice(0, 30);
  }

  function analyzeRecommend(recs) {
    const enemies = analyzeEnemyFreq(recs);
    if (!enemies.length) return [];
    // 高频敌方队伍 key 集合（O(1) 查找）
    const enemyKeySet = new Set(enemies.map(e => teamKey(e.generals, e.tactics, e.formation)));
    const matrix = {};
    let recProcessed = 0, recMatchedRight = 0, recMatchedLeft = 0;
    for (const rec of recs) {
      const lg = normGens(rec.leftGenerals  || rec.left_generals);
      const lt = normTacs(rec.leftTactics   || rec.left_tactics);
      const lf = rec.leftFormation  || rec.left_formation  || '';
      const rg = normGens(rec.rightGenerals || rec.right_generals);
      const rt = normTacs(rec.rightTactics  || rec.right_tactics);
      const rf = rec.rightFormation || rec.right_formation || '';
      if (!lg.length || !rg.length) continue;
      recProcessed++;
      const leftKey  = teamKey(lg, lt, lf);
      const rightKey = teamKey(rg, rt, rf);
      const w = winner(rec.result);
      const leftLoss  = parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);

      // 敌方高频队伍在右侧 → 左侧是潜在克制方
      if (enemyKeySet.has(rightKey)) {
        recMatchedRight++;
        addEncounter(matrix, rightKey, leftKey, lg, lt, lf, w === 'left', leftLoss, rightLoss, rec);
      }
      // 敌方高频队伍在左侧 → 右侧是潜在克制方（左右不同队时）
      if (leftKey !== rightKey && enemyKeySet.has(leftKey)) {
        recMatchedLeft++;
        addEncounter(matrix, leftKey, rightKey, rg, rt, rf, w === 'right', rightLoss, leftLoss, rec);
      }
    }
    return enemies.map(enemy => {
      const ek = teamKey(enemy.generals, enemy.tactics, enemy.formation);
      const allCounters = Object.values(matrix[ek] || {});
      const counters = allCounters
        .filter(c => c.wins > 0)
        .map(c => ({
          generals: c.generals, tactics: c.tactics, formation: c.formation,
          records: c.records,
          wins: c.wins,
          winRate:  c.total ? Math.round(c.wins / c.total * 1000) / 10 : 0,
          lossRate: c.enemyLoss ? Math.round(c.counterLoss / c.enemyLoss * 100) : 0,
          total: c.total
        }))
        .sort((a, b) => b.winRate - a.winRate || b.total - a.total)
        .slice(0, 8);
      return { enemy, counters };
    });
  }

  function addEncounter(matrix, enemyKey, cKey, cGens, cTacs, cForm, cWon, cLoss, eLoss, rec) {
    if (!matrix[enemyKey]) matrix[enemyKey] = {};
    if (!matrix[enemyKey][cKey]) {
      matrix[enemyKey][cKey] = {
        generals: cGens, tactics: cTacs, formation: cForm,
        wins: 0, total: 0, counterLoss: 0, enemyLoss: 0, records: []
      };
    }
    const c = matrix[enemyKey][cKey];
    c.total++;
    if (cWon) c.wins++;
    c.counterLoss += cLoss;
    c.enemyLoss  += eLoss;
    c.records.push(rec);
  }

  // ==================== 渲染：Tab 1 克制关系 ====================

  window.renderCounterAnalysis = async function () {
    const el = document.getElementById('counterAnalysisBody');
    if (!el) return;
    await ensureRecords();
    const recs = records();
    const data = analyzeCounter(recs);
    window._caCounterData = data;

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="7" class="ca-empty">
        暂无克制关系数据<br><small>只要有敌对战报就会显示（武将＋战法＋阵型均相同视为同一队伍）</small>
      </td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => `
      <tr class="ca-row">
        <td class="ca-idx">${i + 1}</td>
        <td class="ca-team-cell">${teamChip(d.left.generals, d.left.tactics, d.left.formation, true)}</td>
        <td class="ca-vs">VS</td>
        <td class="ca-team-cell">${teamChip(d.right.generals, d.right.tactics, d.right.formation, false)}</td>
        <td class="ca-num-cell">${d.total}</td>
        <td class="ca-num-cell ca-green">${d.leftWR}%</td>
        <td class="ca-num-cell">${d.lossRate ? d.lossRate + '%' : '—'}</td>
        <td class="ca-center"><button class="ca-src-btn" onclick="caShowCounterSrc(${i})">溯源</button></td>
      </tr>`).join('');
  };

  window.caShowCounterSrc = function (i) {
    const d = (window._caCounterData || [])[i];
    if (d) showImageSource(d.records);
  };

  // ==================== 渲染：Tab 2 敌方高频 ====================

  window.renderEnemyHighFreq = async function () {
    const el = document.getElementById('enemyHighFreqBody');
    if (!el) return;
    await ensureRecords();
    const data = analyzeEnemyFreq(records());

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="5" class="ca-empty">暂无敌方队伍数据</td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => `
      <tr class="ca-row${i < 3 ? ' ca-top3' : ''}">
        <td class="ca-idx ca-rank${i < 3 ? ' ca-rank-top' : ''}">${i + 1}</td>
        <td>${teamChip(d.generals, d.tactics, d.formation, false)}</td>
        <td class="ca-num-cell ca-freq-num">×${d.count}</td>
      </tr>`).join('');
  };

  // ==================== 渲染：Tab 3 克制推荐 ====================

  window.renderCounterRecommendations = async function () {
    const el = document.getElementById('counterRecommendations');
    if (!el) return;
    await ensureRecords();
    const data = analyzeRecommend(records());
    window._caRecData = data;

    if (!data.length) {
      el.innerHTML = `<div class="ca-empty-blk">暂无克制推荐数据<br><small>需要足够的战报数据才能生成推荐</small></div>`;
      return;
    }

    el.innerHTML = `<div class="ca-rec-header">
        <div class="ca-rec-header-left">敌方高频队伍</div>
        <div class="ca-rec-arrow-spacer"></div>
        <div class="ca-rec-header-right">克制推荐队伍</div>
      </div>
      ${data.map((item, gi) => {
      const countersHtml = item.counters.length
        ? item.counters.map((c, ci) => `
          <div class="ca-rec-counter">
            ${teamChip(c.generals, c.tactics, c.formation, true)}
            <div class="ca-rec-stats">
              <span class="ca-badge ca-badge-win">${c.winRate}% 胜率</span>
              <span class="ca-badge ca-badge-loss">战损 ${c.lossRate}%</span>
              <span class="ca-badge ca-badge-cnt">${c.total} 场</span>
              <button class="ca-src-btn" onclick="caShowRecSrc(${gi},${ci})">溯源</button>
            </div>
          </div>`).join('')
        : `<div class="ca-rec-empty">暂无克制数据</div>`;

      return `<div class="ca-rec-group">
        <div class="ca-rec-enemy">
          <div class="ca-rec-lbl">敌方高频</div>
          ${teamChip(item.enemy.generals, item.enemy.tactics, item.enemy.formation, false)}
          <div class="ca-rec-cnt"><span class="ca-badge ca-badge-cnt">出场 ${item.enemy.count} 次</span></div>
        </div>
        <div class="ca-rec-arrow">▶</div>
        <div class="ca-rec-counters">${countersHtml}</div>
      </div>`;
    }).join('')}`;
  };

  window.caShowRecSrc = function (gi, ci) {
    const d = (window._caRecData || [])[gi];
    if (d && d.counters[ci]) showImageSource(d.counters[ci].records);
  };

  // ==================== UI 框架 ====================

  window.createCounterAnalysisUI = async function (parent) {
    injectStyles();

    parent.innerHTML = `
      <div class="ca-root">
        <div class="ca-tabs">
          <button class="ca-tab active" onclick="switchCounterTab('relationship')" id="caTabRelBtn">克制关系</button>
          <button class="ca-tab" onclick="switchCounterTab('enemy')" id="caTabEnemyBtn">敌方高频</button>
          <button class="ca-tab" onclick="switchCounterTab('recommend')" id="caTabRecBtn">克制推荐</button>
        </div>

        <div id="caPanelRelationship">
          <p class="ca-hint">双方队伍（武将＋战法＋阵型均相同）即可统计，胜率高者显示在左侧</p>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th class="ca-th-idx">#</th>
                <th class="ca-th-team">胜方队伍</th>
                <th class="ca-th-vs"></th>
                <th class="ca-th-team">对手队伍</th>
                <th class="ca-th-num">场次</th>
                <th class="ca-th-num">胜率</th>
                <th class="ca-th-num">战损比</th>
                <th class="ca-th-act">溯源</th>
              </tr></thead>
              <tbody id="counterAnalysisBody"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelEnemy" style="display:none;">
          <p class="ca-hint">敌方（右侧）队伍出场频率 TOP 30，武将＋战法＋阵型相同视为同一队伍</p>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th class="ca-th-idx">#</th>
                <th>队伍（武将 · 阵型 · 战法）</th>
                <th class="ca-th-num">出场</th>
              </tr></thead>
              <tbody id="enemyHighFreqBody"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelRecommend" style="display:none;">
          <p class="ca-hint">针对敌方高频队伍，从所有战报中找出有过战胜记录（胜率 &gt;50%）的克制阵容，按胜率降序</p>
          <div id="counterRecommendations"></div>
        </div>
      </div>`;

    switchCounterTab('relationship');
  };

  window.switchCounterTab = async function (tab) {
    const panels = { relationship: 'caPanelRelationship', enemy: 'caPanelEnemy', recommend: 'caPanelRecommend' };
    const btns   = { relationship: 'caTabRelBtn', enemy: 'caTabEnemyBtn', recommend: 'caTabRecBtn' };
    Object.keys(panels).forEach(t => {
      const p = document.getElementById(panels[t]);
      const b = document.getElementById(btns[t]);
      if (p) p.style.display = t === tab ? 'block' : 'none';
      if (b) b.classList.toggle('active', t === tab);
    });
    if (tab === 'relationship') await renderCounterAnalysis();
    else if (tab === 'enemy')   await renderEnemyHighFreq();
    else                        await renderCounterRecommendations();
  };

  window.showRecordSource = function (i) { window.caShowCounterSrc(i); };

  // ==================== 样式注入 ====================

  function injectStyles() {
    if (document.getElementById('ca-styles')) return;
    const s = document.createElement('style');
    s.id = 'ca-styles';
    s.textContent = `
      /* ---- 根容器 ---- */
      .ca-root{padding:16px;}

      /* ---- tabs ---- */
      .ca-tabs{display:flex;gap:2px;margin-bottom:14px;border-bottom:1px solid var(--border,#2a2a3e);}
      .ca-tab{padding:6px 18px;border:none;border-radius:6px 6px 0 0;background:transparent;
        color:#666;cursor:pointer;font-size:12px;transition:all .15s;letter-spacing:.03em;}
      .ca-tab.active{background:var(--accent,#5b4fff);color:#fff;font-weight:600;}
      .ca-tab:hover:not(.active){color:#aaa;background:rgba(255,255,255,.04);}
      .ca-hint{color:#555;font-size:11px;margin:0 0 10px;line-height:1.6;}

      /* ---- 通用表格 ---- */
      .ca-tbl-wrap{overflow-x:auto;border:1px solid var(--border,#2a2a3e);border-radius:8px;}
      .ca-tbl{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;}
      .ca-tbl th{padding:7px 10px;text-align:left;border-bottom:1px solid var(--border,#2a2a3e);
        color:#666;background:var(--bg2,#111122);font-weight:500;white-space:nowrap;}
      .ca-row td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle;}
      .ca-row:last-child td{border-bottom:none;}
      .ca-row:hover td{background:rgba(255,255,255,.025);}

      /* Tab1 列宽 */
      .ca-th-idx{width:30px;text-align:center;}
      .ca-th-vs{width:28px;text-align:center;}
      .ca-th-team{width:auto;}
      .ca-th-num{width:56px;text-align:center;}
      .ca-th-act{width:46px;text-align:center;}

      /* Tab2 列宽 */
      .ca-th-gen{width:auto;}
      .ca-th-form{width:70px;text-align:center;}
      .ca-th-tac{width:auto;}

      /* ---- 通用单元格 ---- */
      .ca-idx{color:#444;font-size:11px;text-align:center;white-space:nowrap;}
      .ca-vs{color:#c0392b;font-weight:700;text-align:center;font-size:11px;}
      .ca-center{text-align:center;}
      .ca-num-cell{text-align:center;white-space:nowrap;color:#aaa;font-size:12px;}
      .ca-green{color:#2ecc71 !important;font-weight:600;}

      /* ---- 队伍芯片（盒子样式，强关联武将+战法） ---- */
      .ca-team-cell{max-width:220px;}
      .ca-chip{
        display:inline-block;min-width:0;width:100%;
        background:rgba(255,255,255,.03);
        border:1px solid rgba(255,255,255,.07);
        border-radius:6px;
        padding:6px 9px;
        box-sizing:border-box;
      }
      .ca-chip-winner{
        background:rgba(91,79,255,.06);
        border-color:rgba(91,79,255,.25);
        border-left:3px solid var(--accent,#5b4fff);
      }
      .ca-chip-row1{display:flex;align-items:center;gap:4px;white-space:nowrap;
        overflow:hidden;line-height:1.6;font-size:12px;}
      .ca-chip-sep{display:inline-block;width:1px;height:11px;background:#333;flex-shrink:0;}
      .ca-tacs{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px;padding-top:5px;
        border-top:1px solid rgba(255,255,255,.05);}
      .ca-tac{font-size:10px;padding:1px 5px;border-radius:3px;white-space:nowrap;
        background:rgba(91,79,255,.12);color:#9d8fff;border:1px solid rgba(91,79,255,.2);}
      .ca-form-badge{font-size:10px;padding:1px 6px;border-radius:3px;white-space:nowrap;flex-shrink:0;
        background:rgba(245,197,66,.1);color:#f5c542;border:1px solid rgba(245,197,66,.2);}
      .ca-dot{color:#333;margin:0 1px;font-size:10px;}
      .ca-dim{color:#444;font-size:11px;}

      /* ---- Tab2 专用 ---- */
      .ca-freq-num{color:#f39c12;font-weight:700;font-size:13px;text-align:center;}
      .ca-rank-top{color:#f5c542;}
      .ca-top3 td{background:rgba(245,197,66,.03);}

      /* ---- badges ---- */
      .ca-badge{display:inline-block;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap;}
      .ca-badge-win{background:rgba(39,174,96,.15);color:#2ecc71;}
      .ca-badge-loss{background:rgba(74,144,217,.15);color:#4a90d9;}
      .ca-badge-cnt{background:rgba(255,255,255,.07);color:#777;}

      /* ---- 溯源按钮 ---- */
      .ca-src-btn{padding:2px 8px;border:1px solid rgba(91,79,255,.3);border-radius:4px;
        background:rgba(91,79,255,.15);color:#a99eff;font-size:10px;cursor:pointer;
        transition:all .15s;white-space:nowrap;}
      .ca-src-btn:hover{background:rgba(91,79,255,.35);color:#fff;}

      /* ---- 空状态 ---- */
      .ca-empty{text-align:center;color:#555;padding:40px 0 !important;font-size:13px;}
      .ca-empty small{display:block;color:#444;margin-top:6px;font-size:11px;}
      .ca-empty-blk{text-align:center;color:#555;padding:60px 20px;font-size:13px;}
      .ca-empty-blk small{display:block;color:#444;margin-top:6px;font-size:11px;}

      /* ---- Tab3 克制推荐 ---- */
      .ca-rec-header{display:flex;align-items:center;
        background:var(--bg, #0a0a1a);border:1px solid var(--border,#2a2a3e);
        border-radius:8px 8px 0 0;padding:8px 14px;margin-bottom:0;font-weight:600;font-size:11px;
        color:var(--accent,#f0b429);letter-spacing:.04em;}
      .ca-rec-header-left{flex:1 1 0;min-width:0;text-align:center;}
      .ca-rec-header-right{flex:1 1 0;min-width:0;text-align:center;}
      .ca-rec-arrow-spacer{flex:0 0 26px;}
      .ca-rec-group{display:flex;align-items:stretch;
        background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);
        border-top:none;border-radius:0;margin-bottom:0;overflow:hidden;}
      .ca-rec-group:last-child{border-radius:0 0 8px 8px;margin-bottom:8px;}
      .ca-rec-enemy{flex:1 1 0;min-width:0;padding:12px 14px;
        border-right:1px solid var(--border,#2a2a3e);
        display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,.01);}
      .ca-rec-lbl{font-size:10px;color:#555;font-weight:600;letter-spacing:.05em;text-transform:uppercase;}
      .ca-rec-cnt{margin-top:2px;}
      .ca-rec-arrow{flex:0 0 26px;display:flex;align-items:center;justify-content:center;
        color:#333;font-size:11px;}
      .ca-rec-counters{flex:1 1 0;min-width:0;display:flex;flex-direction:column;}
      .ca-rec-counter{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.04);
        display:flex;flex-direction:column;gap:6px;}
      .ca-rec-counter:last-child{border-bottom:none;}
      .ca-rec-empty{color:var(--text3,#888);font-size:12px;padding:16px 14px;font-style:italic;}
      .ca-rec-stats{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
    `;
    document.head.appendChild(s);
  }

  console.log('[counter-analysis] 已加载 v202605120002 ✅');
})();

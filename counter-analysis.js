/**
 * 克制分析模块 v202605110003
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
      try { await loadAllRecords(); } catch (e) { /* ignore */ }
    }
  }

  // ==================== 渲染工具 ====================

  // 队伍芯片：第一行武将+阵型，第二行战法，最多2行
  function teamChip(generals, tactics, formation, winner) {
    const gens = normGens(generals);
    const tacs = normTacs(tactics);
    const form = (formation || '').trim();

    const gHtml = gens.length
      ? gens.map(g => `<b style="color:${heroColor(g)}">${escHtml(g)}</b>`).join('<span class="ca-dot">·</span>')
      : '<span class="ca-dim">—</span>';

    const formHtml = form
      ? `<span class="ca-form-badge">${escHtml(form)}</span>`
      : '';

    const tacHtml = tacs.length
      ? `<div class="ca-tacs">${tacs.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')}</div>`
      : '';

    return `<div class="ca-chip${winner ? ' ca-chip-winner' : ''}">
      <div class="ca-chip-top">${gHtml}${formHtml ? `<span class="ca-chip-sep"></span>${formHtml}` : ''}</div>
      ${tacHtml}
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
      .filter(g => g.total >= 2)
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
    const matrix = {};
    for (const rec of recs) {
      const lg = normGens(rec.leftGenerals  || rec.left_generals);
      const lt = normTacs(rec.leftTactics   || rec.left_tactics);
      const lf = rec.leftFormation  || rec.left_formation  || '';
      const rg = normGens(rec.rightGenerals || rec.right_generals);
      const rt = normTacs(rec.rightTactics  || rec.right_tactics);
      const rf = rec.rightFormation || rec.right_formation || '';
      if (!lg.length || !rg.length) continue;
      const ek = teamKey(rg, rt, rf);
      const ok = teamKey(lg, lt, lf);
      if (!matrix[ek]) matrix[ek] = {};
      if (!matrix[ek][ok]) {
        matrix[ek][ok] = { generals: lg, tactics: lt, formation: lf, wins: 0, total: 0, ourLoss: 0, enLoss: 0, records: [] };
      }
      const c = matrix[ek][ok];
      c.total++;
      c.records.push(rec);
      c.ourLoss += parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      c.enLoss  += parseFloat(rec.rightLoss || rec.right_loss || 0);
      if (winner(rec.result) === 'left') c.wins++;
    }
    return enemies.map(enemy => {
      const ek = teamKey(enemy.generals, enemy.tactics, enemy.formation);
      const counters = Object.values(matrix[ek] || {})
        .map(c => ({
          generals: c.generals, tactics: c.tactics, formation: c.formation,
          records: c.records,
          winRate:  c.total ? Math.round(c.wins / c.total * 1000) / 10 : 0,
          lossRate: c.enLoss ? Math.round(c.ourLoss / c.enLoss * 100) : 0,
          total: c.total
        }))
        .filter(c => c.winRate > 50)
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, 5);
      return counters.length ? { enemy, counters } : null;
    }).filter(Boolean);
  }

  // ==================== 渲染：克制关系 ====================

  window.renderCounterAnalysis = async function () {
    const el = document.getElementById('counterAnalysisBody');
    if (!el) return;
    await ensureRecords();
    const recs = records();
    const data = analyzeCounter(recs);
    window._caCounterData = data;

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="7" class="ca-empty">
        暂无克制关系数据<br><small>需要至少两条双方队伍（武将+战法+阵型完全相同）的战报</small>
      </td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => `
      <tr class="ca-row">
        <td class="ca-idx">${i + 1}</td>
        <td>${teamChip(d.left.generals, d.left.tactics, d.left.formation, true)}</td>
        <td class="ca-vs">VS</td>
        <td>${teamChip(d.right.generals, d.right.tactics, d.right.formation, false)}</td>
        <td class="ca-stat-cell">
          <span class="ca-badge ca-badge-cnt">${d.total}场</span>
          <span class="ca-badge ca-badge-win">${d.leftWins}胜</span>
          <span class="ca-badge ca-badge-rate">${d.leftWR}%</span>
          ${d.lossRate ? `<span class="ca-badge ca-badge-loss">战损${d.lossRate}%</span>` : ''}
        </td>
        <td class="ca-center">
          <button class="ca-src-btn" onclick="caShowCounterSrc(${i})">溯源</button>
        </td>
      </tr>`).join('');
  };

  window.caShowCounterSrc = function (i) {
    const d = (window._caCounterData || [])[i];
    if (d) showImageSource(d.records);
  };

  // ==================== 渲染：敌方高频 ====================

  window.renderEnemyHighFreq = async function () {
    const el = document.getElementById('enemyHighFreqGrid');
    if (!el) return;
    await ensureRecords();
    const data = analyzeEnemyFreq(records());

    if (!data.length) {
      el.innerHTML = `<div class="ca-empty-blk">暂无敌方队伍数据</div>`;
      return;
    }

    el.innerHTML = data.map((d, i) => {
      const gens = d.generals.map(g =>
        `<b style="color:${heroColor(g)}">${escHtml(g)}</b>`
      ).join('<span class="ca-dot">·</span>');
      const form = d.formation ? `<span class="ca-form-badge">${escHtml(d.formation)}</span>` : '';
      const tacs = d.tactics.length
        ? d.tactics.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')
        : '';
      return `<div class="ca-freq-card">
        <span class="ca-freq-rank">${i + 1}</span>
        <div class="ca-freq-body">
          <div class="ca-chip-top">${gens}${form ? `<span class="ca-chip-sep"></span>${form}` : ''}</div>
          ${tacs ? `<div class="ca-tacs" style="margin-top:4px">${tacs}</div>` : ''}
        </div>
        <span class="ca-freq-cnt">×${d.count}</span>
      </div>`;
    }).join('');
  };

  // ==================== 渲染：高频克制推荐 ====================

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

    el.innerHTML = data.map((item, gi) => {
      const enemyChip = teamChip(item.enemy.generals, item.enemy.tactics, item.enemy.formation, false);
      const countersHtml = item.counters.map((c, ci) => `
        <div class="ca-rec-counter">
          ${teamChip(c.generals, c.tactics, c.formation, true)}
          <div class="ca-rec-badges">
            <span class="ca-badge ca-badge-win">${c.winRate}%胜率</span>
            <span class="ca-badge ca-badge-loss">战损${c.lossRate}%</span>
            <span class="ca-badge ca-badge-cnt">${c.total}场</span>
            <button class="ca-src-btn" onclick="caShowRecSrc(${gi},${ci})">溯源</button>
          </div>
        </div>`).join('');

      return `<div class="ca-rec-group">
        <div class="ca-rec-left">
          <div class="ca-rec-lbl">👹 敌方高频</div>
          ${enemyChip}
          <div style="margin-top:6px"><span class="ca-badge ca-badge-cnt">出场${item.enemy.count}次</span></div>
        </div>
        <div class="ca-rec-arrow">▶</div>
        <div class="ca-rec-right">${countersHtml}</div>
      </div>`;
    }).join('');
  };

  window.caShowRecSrc = function (gi, ci) {
    const d = (window._caRecData || [])[gi];
    if (d && d.counters[ci]) showImageSource(d.counters[ci].records);
  };

  // ==================== UI 框架 ====================

  window.createCounterAnalysisUI = async function (parent) {
    injectStyles();

    parent.innerHTML = `
      <div style="padding:16px;">
        <div class="ca-tabs">
          <button class="ca-tab active" onclick="switchCounterTab('relationship')" id="caTabRelBtn">⚔️ 克制关系</button>
          <button class="ca-tab" onclick="switchCounterTab('enemy')"        id="caTabEnemyBtn">👹 敌方高频</button>
          <button class="ca-tab" onclick="switchCounterTab('recommend')"    id="caTabRecBtn">🎯 克制推荐</button>
        </div>

        <div id="caPanelRelationship">
          <p class="ca-hint">双方队伍（武将+战法+阵型均相同）对战 ≥2 次时统计，胜率高者显示在左侧</p>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th style="width:28px">#</th>
                <th>胜方队伍</th>
                <th style="width:32px"></th>
                <th>对手队伍</th>
                <th>统计</th>
                <th style="width:48px">溯源</th>
              </tr></thead>
              <tbody id="counterAnalysisBody"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelEnemy" style="display:none;">
          <p class="ca-hint">敌方（右侧）队伍出场频率 TOP 30，武将+战法+阵型相同视为同一队伍</p>
          <div id="enemyHighFreqGrid" class="ca-freq-grid"></div>
        </div>

        <div id="caPanelRecommend" style="display:none;">
          <p class="ca-hint">针对敌方高频队伍，列出我方胜率 &gt;50% 的克制阵容，按胜率降序</p>
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
      /* ---- tabs ---- */
      .ca-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border,#333);}
      .ca-tab{padding:7px 16px;border:none;border-radius:6px 6px 0 0;
        background:transparent;color:#666;cursor:pointer;font-size:13px;transition:all .15s;}
      .ca-tab.active{background:var(--accent,#5b4fff);color:#fff;font-weight:600;}
      .ca-tab:hover:not(.active){color:#aaa;}
      .ca-hint{color:#666;font-size:11px;margin:0 0 10px;line-height:1.5;}

      /* ---- table ---- */
      .ca-tbl-wrap{overflow-x:auto;border:1px solid var(--border,#2a2a3e);border-radius:8px;}
      .ca-tbl{width:100%;border-collapse:collapse;font-size:12px;}
      .ca-tbl th{padding:7px 10px;text-align:left;border-bottom:1px solid var(--border,#2a2a3e);
        color:#777;background:var(--bg2,#111122);font-weight:500;white-space:nowrap;}
      .ca-row td{padding:7px 10px;border-bottom:1px solid var(--border,#1e1e30);vertical-align:middle;}
      .ca-row:last-child td{border-bottom:none;}
      .ca-row:hover td{background:rgba(255,255,255,.025);}
      .ca-idx{color:#444;font-size:11px;text-align:center;}
      .ca-vs{color:#c0392b;font-weight:700;text-align:center;font-size:11px;}
      .ca-center{text-align:center;}

      /* ---- team chip ---- */
      .ca-chip{min-width:140px;}
      .ca-chip-winner .ca-chip-top{border-left:3px solid var(--accent,#5b4fff);padding-left:7px;}
      .ca-chip-top{display:flex;flex-wrap:wrap;align-items:center;gap:5px;line-height:1.5;font-size:12px;}
      .ca-chip-sep{display:inline-block;width:1px;height:12px;background:#333;margin:0 1px;}
      .ca-tacs{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;}
      .ca-tac{font-size:10px;padding:1px 5px;border-radius:3px;
        background:rgba(91,79,255,.13);color:#a99eff;border:1px solid rgba(91,79,255,.2);}
      .ca-form-badge{font-size:10px;padding:1px 6px;border-radius:3px;
        background:rgba(245,197,66,.1);color:#f5c542;border:1px solid rgba(245,197,66,.2);}
      .ca-dot{color:#3a3a50;margin:0 1px;font-size:10px;}
      .ca-dim{color:#555;font-size:11px;}

      /* ---- stat badges ---- */
      .ca-stat-cell{white-space:nowrap;}
      .ca-badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:10px;margin:2px 2px 2px 0;}
      .ca-badge-win{background:rgba(39,174,96,.15);color:#2ecc71;}
      .ca-badge-rate{background:rgba(243,156,18,.15);color:#f39c12;font-weight:600;}
      .ca-badge-loss{background:rgba(74,144,217,.15);color:#4a90d9;}
      .ca-badge-cnt{background:rgba(255,255,255,.07);color:#888;}

      /* ---- source btn ---- */
      .ca-src-btn{padding:3px 9px;border:none;border-radius:4px;
        background:rgba(91,79,255,.25);color:#a99eff;font-size:10px;cursor:pointer;
        border:1px solid rgba(91,79,255,.3);transition:all .15s;}
      .ca-src-btn:hover{background:rgba(91,79,255,.4);color:#fff;}

      /* ---- empty ---- */
      .ca-empty{text-align:center;color:#555;padding:40px 0!important;font-size:13px;}
      .ca-empty small{display:block;color:#444;margin-top:6px;font-size:11px;}
      .ca-empty-blk{text-align:center;color:#555;padding:60px 20px;font-size:13px;}
      .ca-empty-blk small{display:block;color:#444;margin-top:6px;font-size:11px;}

      /* ---- 敌方高频 card grid ---- */
      .ca-freq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;}
      .ca-freq-card{display:flex;align-items:flex-start;gap:8px;
        background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);
        border-radius:8px;padding:10px 12px;transition:border-color .15s;}
      .ca-freq-card:hover{border-color:rgba(91,79,255,.4);}
      .ca-freq-rank{flex:0 0 22px;height:22px;line-height:22px;text-align:center;
        font-size:11px;font-weight:700;border-radius:50%;background:rgba(255,255,255,.06);
        color:#666;margin-top:1px;}
      .ca-freq-card:nth-child(-n+3) .ca-freq-rank{background:rgba(245,197,66,.18);color:#f5c542;}
      .ca-freq-body{flex:1;min-width:0;}
      .ca-freq-cnt{flex:0 0 auto;font-size:13px;font-weight:700;color:#f39c12;
        align-self:center;white-space:nowrap;}

      /* ---- 高频克制推荐 ---- */
      .ca-rec-group{display:flex;align-items:stretch;gap:0;
        background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);
        border-radius:10px;margin-bottom:10px;overflow:hidden;}
      .ca-rec-left{flex:0 0 220px;min-width:180px;padding:14px 16px;
        border-right:1px solid var(--border,#2a2a3e);display:flex;flex-direction:column;gap:6px;}
      .ca-rec-lbl{font-size:10px;color:#666;font-weight:600;letter-spacing:.05em;}
      .ca-rec-arrow{flex:0 0 32px;display:flex;align-items:center;justify-content:center;
        color:#444;font-size:12px;}
      .ca-rec-right{flex:1;display:flex;flex-direction:column;gap:0;}
      .ca-rec-counter{padding:12px 14px;border-bottom:1px solid var(--border,#1e1e30);
        display:flex;align-items:center;gap:12px;}
      .ca-rec-counter:last-child{border-bottom:none;}
      .ca-rec-counter .ca-chip{flex:1;}
      .ca-rec-badges{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:flex-end;}
    `;
    document.head.appendChild(s);
  }

  console.log('[counter-analysis] 已加载 v202605110003 ✅');
})();

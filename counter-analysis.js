/**
 * 克制分析模块 v202605110001
 * 1. 克制关系分析  2. 敌方高频队伍  3. 高频克制推荐
 */
(function () {
  'use strict';

  // ==================== 工具函数 ====================

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // 兼容：JSON 字符串 / 普通逗号字符串 / 数组
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

  const normGens  = v => normalizeArr(v);
  const normTacs  = v => normalizeArr(v, ['未知']);

  function teamKey(gens, tacs, form) {
    return normGens(gens).sort().join('|')
      + '@' + (form || '').trim()
      + '#' + normTacs(tacs).sort().join('|');
  }

  // '胜' → 左侧获胜；'败' → 右侧获胜；其余 → 平
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

  // --- 1. 克制关系分析 ---
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
          aW: 0, bW: 0, draws: 0,
          aLoss: 0, bLoss: 0, total: 0, records: []
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

    // 只保留对战次数 ≥ 2 的组合
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

  // --- 2. 敌方高频队伍 ---
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

  // --- 3. 高频克制推荐 ---
  function analyzeRecommend(recs) {
    const enemies = analyzeEnemyFreq(recs);
    if (!enemies.length) return [];

    // 对每种敌方队伍，统计我方各队伍的胜负
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
        matrix[ek][ok] = {
          generals: lg, tactics: lt, formation: lf,
          wins: 0, total: 0, ourLoss: 0, enLoss: 0, records: []
        };
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

  // ==================== 渲染工具 ====================

  function teamCard(generals, tactics, formation, cls) {
    cls = cls || '';
    const gs = generals.map(g =>
      `<span style="color:${heroColor(g)};font-weight:bold;">${escHtml(g)}</span>`
    ).join('<span class="ca-dot">·</span>');

    const ts = tactics.length
      ? tactics.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')
      : '<span class="ca-dim">暂无战法</span>';

    return `<div class="ca-card ${cls}">
      <div class="ca-gens">${gs}</div>
      <div class="ca-tacs">${ts}</div>
      <div class="ca-form">阵型：${escHtml(formation || '-')}</div>
    </div>`;
  }

  // ==================== 渲染：克制关系 ====================

  window.renderCounterAnalysis = async function () {
    const el = document.getElementById('counterAnalysisBody');
    if (!el) return;
    await ensureRecords();
    const recs = records();
    console.log('[CA] 克制关系分析 records:', recs.length,
      recs[0] ? '第一条keys:' + Object.keys(recs[0]).join(',') : '(空)');
    const data = analyzeCounter(recs);
    console.log('[CA] 克制关系分析 结果组数:', data.length);
    window._caCounterData = data;

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="9" class="ca-empty">
        暂无克制关系数据<br><small>需要至少两条双方队伍（武将+战法+阵型）完全相同的战报</small>
      </td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => `
      <tr class="ca-row">
        <td class="ca-idx">${i + 1}</td>
        <td>${teamCard(d.left.generals,  d.left.tactics,  d.left.formation,  'ca-winner')}</td>
        <td class="ca-vs">VS</td>
        <td>${teamCard(d.right.generals, d.right.tactics, d.right.formation, '')}</td>
        <td class="ca-num ca-bold">${d.total}</td>
        <td class="ca-num ca-green">${d.leftWins}</td>
        <td class="ca-num ca-orange">${d.leftWR}%</td>
        <td class="ca-num ca-blue">${d.lossRate}%</td>
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
    const el = document.getElementById('enemyHighFreqBody');
    if (!el) return;
    await ensureRecords();
    const recs = records();
    const first = recs[0];
    if (first) {
      console.log('[CA] 敌方高频 第一条记录:', {
        rightGenerals: first.rightGenerals || first.right_generals,
        leftGenerals:  first.leftGenerals  || first.left_generals,
        result:        first.result
      });
    }
    const data = analyzeEnemyFreq(recs);
    console.log('[CA] 敌方高频 records:', recs.length, '分析结果:', data.length);

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="4" class="ca-empty">暂无敌方队伍数据</td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => {
      const gs = d.generals.map(g =>
        `<span style="color:${heroColor(g)};font-weight:bold;">${escHtml(g)}</span>`
      ).join('<span class="ca-dot">·</span>');
      const ts = d.tactics.length
        ? d.tactics.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')
        : '<span class="ca-dim">-</span>';
      return `<tr class="ca-row">
        <td class="ca-idx">${i + 1}</td>
        <td><div class="ca-gens">${gs}</div></td>
        <td><div class="ca-tacs">${ts}</div></td>
        <td class="ca-num ca-bold">${d.count}</td>
      </tr>`;
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
      const eg = item.enemy.generals.map(g =>
        `<div style="color:${heroColor(g)};font-weight:bold;margin:2px 0;">${escHtml(g)}</div>`
      ).join('');
      const et = item.enemy.tactics.length
        ? item.enemy.tactics.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')
        : '<span class="ca-dim">-</span>';

      const countersHtml = item.counters.map((c, ci) => {
        const cg = c.generals.map(g =>
          `<div style="color:${heroColor(g)};font-weight:bold;margin:2px 0;">${escHtml(g)}</div>`
        ).join('');
        const ct = c.tactics.length
          ? c.tactics.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('')
          : '<span class="ca-dim">-</span>';
        return `<div class="ca-purple-card">
          <div class="ca-card-lbl">克制推荐 #${ci + 1}</div>
          <div class="ca-gens">${cg}</div>
          <div class="ca-tacs">${ct}</div>
          <div class="ca-form">阵型：${escHtml(c.formation || '-')}</div>
          <div class="ca-badges">
            <span class="ca-badge ca-badge-win">${c.winRate}% 胜率</span>
            <span class="ca-badge ca-badge-loss">战损率 ${c.lossRate}%</span>
            <span class="ca-badge ca-badge-cnt">${c.total} 场</span>
          </div>
          <button class="ca-src-btn" onclick="caShowRecSrc(${gi},${ci})">图片溯源</button>
        </div>`;
      }).join('');

      return `<div class="ca-rec-group">
        <div class="ca-purple-card ca-rec-enemy">
          <div class="ca-card-lbl">👹 敌方高频队伍</div>
          <div class="ca-gens">${eg}</div>
          <div class="ca-tacs">${et}</div>
          <div class="ca-form">阵型：${escHtml(item.enemy.formation || '-')}</div>
          <div class="ca-cnt-txt">出场 ${item.enemy.count} 次</div>
        </div>
        <div class="ca-rec-arrow">🛡️</div>
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
          <button class="ca-tab active" onclick="switchCounterTab('relationship')" id="caTabRelBtn">⚔️ 克制关系分析</button>
          <button class="ca-tab" onclick="switchCounterTab('enemy')"        id="caTabEnemyBtn">👹 敌方高频队伍</button>
          <button class="ca-tab" onclick="switchCounterTab('recommend')"    id="caTabRecBtn">🎯 高频克制推荐</button>
        </div>

        <div id="caPanelRelationship">
          <p class="ca-hint">💡 双方队伍（武将+战法+阵型完全相同）对战 ≥2 次时统计，胜率高的显示在左侧</p>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th>#</th><th>胜率高队伍</th><th></th><th>对手队伍</th>
                <th class="ca-r">对战次数</th><th class="ca-r">获胜次数</th>
                <th class="ca-r">胜率</th><th class="ca-r">战损率</th><th>溯源</th>
              </tr></thead>
              <tbody id="counterAnalysisBody"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelEnemy" style="display:none;">
          <p class="ca-hint">💡 敌方（右侧）队伍出现频率 TOP 30，武将+战法相同视为同一队伍</p>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th>#</th><th>武将</th><th>战法</th><th class="ca-r">出现次数</th>
              </tr></thead>
              <tbody id="enemyHighFreqBody"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelRecommend" style="display:none;">
          <p class="ca-hint">💡 针对敌方高频队伍，列出我方胜率 &gt; 50% 的克制阵容，按胜率降序排列</p>
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

  // backward compat
  window.showRecordSource = function (i) { window.caShowCounterSrc(i); };

  // ==================== 样式注入 ====================

  function injectStyles() {
    if (document.getElementById('ca-styles')) return;
    const s = document.createElement('style');
    s.id = 'ca-styles';
    s.textContent = `
      .ca-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border,#333);}
      .ca-tab{padding:8px 18px;border:none;border-radius:6px 6px 0 0;background:var(--bg2,#1a1a2e);
        color:#888;cursor:pointer;font-size:13px;transition:all .2s;}
      .ca-tab.active{background:var(--accent,#5b4fff);color:#fff;font-weight:bold;}
      .ca-hint{color:#888;font-size:12px;margin:0 0 12px;}

      .ca-tbl-wrap{overflow-x:auto;border:1px solid var(--border,#333);border-radius:8px;}
      .ca-tbl{width:100%;border-collapse:collapse;font-size:12px;}
      .ca-tbl th{padding:8px 10px;text-align:left;border-bottom:2px solid var(--border,#333);
        color:#aaa;background:var(--bg2,#1a1a2e);white-space:nowrap;}
      .ca-tbl .ca-r{text-align:right;}
      .ca-row td{padding:8px 10px;border-bottom:1px solid var(--border,#2a2a3e);vertical-align:top;}
      .ca-row:hover td{background:rgba(255,255,255,.03);}

      .ca-idx{color:#555;font-size:11px;width:28px;text-align:center;}
      .ca-vs{color:#e74c3c;font-weight:bold;text-align:center;vertical-align:middle!important;width:28px;}
      .ca-center{text-align:center;}
      .ca-num{text-align:right;white-space:nowrap;}
      .ca-bold{font-weight:bold;color:#ddd;}
      .ca-green{color:#27ae60;font-weight:bold;}
      .ca-orange{color:#f39c12;font-weight:bold;}
      .ca-blue{color:#4a90d9;}

      .ca-card{display:flex;flex-direction:column;gap:4px;min-width:150px;}
      .ca-winner .ca-gens{border-left:3px solid var(--accent,#5b4fff);padding-left:6px;}
      .ca-gens{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
      .ca-dot{color:#444;margin:0 2px;}
      .ca-tacs{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;}
      .ca-tac{font-size:10px;padding:1px 5px;border-radius:3px;
        background:rgba(91,79,255,.14);color:#a99eff;border:1px solid rgba(91,79,255,.22);}
      .ca-form{font-size:10px;color:#666;margin-top:2px;}
      .ca-dim{font-size:11px;color:#555;}

      .ca-src-btn{padding:3px 10px;border:none;border-radius:4px;
        background:var(--accent,#5b4fff);color:#fff;font-size:11px;cursor:pointer;opacity:.85;}
      .ca-src-btn:hover{opacity:1;}

      .ca-empty{text-align:center;color:#666;padding:40px 0!important;font-size:13px;}
      .ca-empty small{display:block;color:#555;margin-top:6px;font-size:11px;}
      .ca-empty-blk{text-align:center;color:#666;padding:60px 20px;font-size:13px;}
      .ca-empty-blk small{display:block;color:#555;margin-top:6px;font-size:11px;}

      /* 高频克制推荐 */
      .ca-rec-group{display:flex;gap:14px;align-items:flex-start;
        background:var(--bg2,#1a1a2e);border:1px solid var(--border,#333);
        border-radius:12px;padding:16px;margin-bottom:14px;}
      .ca-rec-enemy{flex:0 0 200px;min-width:160px;}
      .ca-rec-arrow{flex:0 0 auto;font-size:26px;padding-top:28px;opacity:.6;}
      .ca-rec-right{flex:1;display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;}

      .ca-purple-card{background:rgba(91,79,255,.1);border:1px solid rgba(91,79,255,.28);
        border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:5px;}
      .ca-card-lbl{font-size:10px;color:#9b8bff;font-weight:bold;letter-spacing:.05em;}
      .ca-cnt-txt{font-size:11px;color:#f39c12;}
      .ca-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;}
      .ca-badge{font-size:10px;padding:2px 7px;border-radius:10px;}
      .ca-badge-win{background:rgba(39,174,96,.18);color:#2ecc71;}
      .ca-badge-loss{background:rgba(74,144,217,.18);color:#4a90d9;}
      .ca-badge-cnt{background:rgba(255,255,255,.07);color:#aaa;}
    `;
    document.head.appendChild(s);
  }

  console.log('[counter-analysis] 已加载 ✅');
})();

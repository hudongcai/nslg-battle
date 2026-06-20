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

  // 仅用武将组合作为 key，忽略战法和阵型
  function teamKeyNoTacs(gens) {
    return normGens(gens).sort().join('|');
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

  // ---- 克制关系 Tab 排序 ----
  let caSortField = 'total';
  let caSortDir = 'desc';

  function caToggleSort(field) {
    if (caSortField === field) caSortDir = caSortDir === 'asc' ? 'desc' : 'asc';
    else { caSortField = field; caSortDir = 'desc'; }
    renderCounterAnalysis();
  }

  function caSortArrow(field) {
    if (caSortField !== field) return '<span class="ca-sort-arrow">↕</span>';
    return `<span class="ca-sort-arrow ca-sort-active">${caSortDir === 'asc' ? '▲' : '▼'}</span>`;
  }

  function caFilterData(data) {
    const w = (document.getElementById('caSearchWinner')?.value || '').trim().toLowerCase();
    const l = (document.getElementById('caSearchLoser')?.value || '').trim().toLowerCase();
    if (!w && !l) return data;
    return data.filter(d => {
      if (w) {
        const wg = normGens(d.left.generals).map(s => s.toLowerCase());
        const wt = normTacs(d.left.tactics).map(s => s.toLowerCase());
        const wf = (d.left.formation || '').toLowerCase();
        if (!wg.some(s => s.includes(w)) && !wt.some(s => s.includes(w)) && !wf.includes(w)) return false;
      }
      if (l) {
        const lg = normGens(d.right.generals).map(s => s.toLowerCase());
        const lt = normTacs(d.right.tactics).map(s => s.toLowerCase());
        const lf = (d.right.formation || '').toLowerCase();
        if (!lg.some(s => s.includes(l)) && !lt.some(s => s.includes(l)) && !lf.includes(l)) return false;
      }
      return true;
    });
  }

  function caSortData(data) {
    return [...data].sort((a, b) => {
      let va, vb;
      switch (caSortField) {
        case 'total': va = a.total; vb = b.total; break;
        case 'leftWR': va = a.leftWR; vb = b.leftWR; break;
        case 'lossRate': va = a.lossRate; vb = b.lossRate; break;
        default: return 0;
      }
      return caSortDir === 'asc' ? va - vb : vb - va;
    });
  }

  window.caClearFilters = function () {
    const ids = ['caSearchWinner', 'caSearchLoser'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderCounterAnalysis();
  };

  // ---- 克制推荐 Tab 排序 ----
  let caRecSortField = 'winRate';
  let caRecSortDir = 'desc';

  // ---- 克制推荐（无战法）Tab 排序 ----
  let caRecNTSortField = 'winRate';
  let caRecNTSortDir = 'desc';

  window.caRecToggleSort = function (field) {
    if (caRecSortField === field) caRecSortDir = caRecSortDir === 'asc' ? 'desc' : 'asc';
    else { caRecSortField = field; caRecSortDir = 'desc'; }
    renderCounterRecommendations();
  };

  function caRecSortArrow(field) {
    if (caRecSortField !== field) return '<span class="ca-sort-arrow">↕</span>';
    return `<span class="ca-sort-arrow ca-sort-active">${caRecSortDir === 'asc' ? '▲' : '▼'}</span>`;
  }

  function caRecSortCounters(counters) {
    return [...counters].sort((a, b) => {
      let va, vb;
      switch (caRecSortField) {
        case 'winRate': va = a.winRate; vb = b.winRate; break;
        case 'lossRate': va = a.lossRate; vb = b.lossRate; break;
        case 'total': va = a.total; vb = b.total; break;
        default: return 0;
      }
      return caRecSortDir === 'asc' ? va - vb : vb - va;
    });
  }

  window.caRecNTToggleSort = function (field) {
    if (caRecNTSortField === field) caRecNTSortDir = caRecNTSortDir === 'asc' ? 'desc' : 'asc';
    else { caRecNTSortField = field; caRecNTSortDir = 'desc'; }
    renderCounterRecommendationsNoTacs();
  };

  function caRecNTSortArrow(field) {
    if (caRecNTSortField !== field) return '<span class="ca-sort-arrow">↕</span>';
    return `<span class="ca-sort-arrow ca-sort-active">${caRecNTSortDir === 'asc' ? '▲' : '▼'}</span>`;
  }

  function caRecNTSortCounters(counters) {
    return [...counters].sort((a, b) => {
      let va, vb;
      switch (caRecNTSortField) {
        case 'winRate': va = a.winRate; vb = b.winRate; break;
        case 'lossRate': va = a.lossRate; vb = b.lossRate; break;
        case 'total': va = a.total; vb = b.total; break;
        default: return 0;
      }
      return caRecNTSortDir === 'asc' ? va - vb : vb - va;
    });
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

  // 竖排队伍芯片：左列武将，中列战法，右列阵型，可选额外列（上下居中）
  function teamChip(generals, tactics, formation, isWinner, extra) {
    const gens = normGens(generals);
    const tacs = normTacs(tactics);
    const form = (formation || '').trim();
    const borderColor = isWinner === true ? 'var(--green)' : isWinner === false ? 'var(--red)' : 'var(--border)';

    let html = `<div class="ca-team" style="border-left:3px solid ${borderColor};padding-left:8px;">`;

    if (!gens.length) {
      html += '<span class="ca-dim">—</span>';
    } else {
      html += '<table class="ca-gen-table">';
      for (let i = 0; i < gens.length; i++) {
        const base = i * 3;
        const gt = [tacs[base] || '', tacs[base + 1] || '', tacs[base + 2] || ''].filter(t => t && t !== '未知');
        const tStr = gt.length
          ? gt.map(t => `<span class="ca-tac">${escHtml(t)}</span>`).join('<span class="ca-tac-sep">/</span>')
          : '<span class="ca-dim">—</span>';
        html += `<tr class="ca-gen-row">
          <td class="ca-gen-name"><b style="color:${heroColor(gens[i])}">${escHtml(gens[i])}</b></td>
          <td class="ca-gen-tacs">${tStr}</td>`;
        if (i === 0) {
          if (form) html += `<td class="ca-gen-form" rowspan="${gens.length}"><span class="ca-form-badge">${escHtml(form)}</span></td>`;
          if (extra) html += `<td class="${extra.cls || 'ca-gen-extra'}" rowspan="${gens.length}">${extra.html}</td>`;
        }
        html += `</tr>`;
      }
      html += '</table>';
    }

    html += '</div>';
    return html;
  }

  // 无战法队伍芯片：只显示武将名，不显示战法/阵型列
  function teamChipNoTacs(generals, isWinner, extra) {
    const gens = normGens(generals);
    const borderColor = isWinner === true ? 'var(--green)' : isWinner === false ? 'var(--red)' : 'var(--border)';
    let html = `<div class="ca-team" style="border-left:3px solid ${borderColor};padding-left:8px;">`;
    if (!gens.length) {
      html += '<span class="ca-dim">—</span>';
    } else {
      html += '<table class="ca-gen-table"><tbody>';
      gens.forEach((g, i) => {
        html += `<tr class="ca-gen-row">
          <td class="ca-gen-name" colspan="2"><b style="color:${heroColor(g)}">${escHtml(g)}</b></td>`;
        if (i === 0 && extra) html += `<td class="${extra.cls || 'ca-gen-extra'}" rowspan="${gens.length}">${extra.html}</td>`;
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  // ==================== 图片溯源 ====================

  async function showImageSource(recs) {
    // 优先用内存中的图片；若无则按 cloudId 从后端实时拉取
    const resolved = await Promise.all(recs.map(async r => {
      if (r.imageBase64 || r.imageData) return r.imageBase64 || r.imageData;
      const cid = r.cloudId || r.cloud_id;
      if (!cid) return null;
      try {
        const base = typeof CLOUD_API_BASE !== 'undefined' ? CLOUD_API_BASE : '/api';
        const res = await fetch(`${base}/gallery/by-battle/${cid}`);
        const json = await res.json();
        if (json.code === 200 && json.data && json.data.image_data) return json.data.image_data;
      } catch(e) {}
      return null;
    }));
    const imgs = resolved.filter(Boolean);
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
      const lg = normGens(getGenerals(rec, 'left'));
      const lt = normTacs(getTactics(rec, 'left'));
      const lf = rec.leftFormation  || rec.left_formation  || '';
      const rg = normGens(getGenerals(rec, 'right'));
      const rt = normTacs(getTactics(rec, 'right'));
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
      const rg = normGens(getGenerals(rec, 'right'));
      const rt = normTacs(getTactics(rec, 'right'));
      const rf = rec.rightFormation || rec.right_formation || '';
      if (!rg.length) continue;
      const k = teamKey(rg, rt, rf);
      if (!stats[k]) stats[k] = { generals: rg, tactics: rt, formation: rf, count: 0 };
      stats[k].count++;
    }
    return Object.values(stats).sort((a, b) => b.count - a.count).slice(0, 30);
  }

  // 判断某条战报是否双方均无战法
  function hasNoTactics(rec) {
    const lt = normTacs(getTactics(rec, 'left'));
    const rt = normTacs(getTactics(rec, 'right'));
    return lt.length === 0 && rt.length === 0;
  }

  // 高频统计（无战法）：所有记录，仅以武将组合区分，不区分战法与阵型
  function analyzeEnemyFreqNoTacs(recs) {
    const stats = {};
    for (const rec of recs) {
      const rg = normGens(getGenerals(rec, 'right'));
      if (!rg.length) continue;
      const k = teamKeyNoTacs(rg);
      if (!stats[k]) stats[k] = { generals: normGens(rg).sort(), count: 0 };
      stats[k].count++;
    }
    return Object.values(stats).sort((a, b) => b.count - a.count);
  }

  function analyzeRecommend(recs) {
    const enemies = analyzeEnemyFreq(recs);
    if (!enemies.length) return [];
    // 高频敌方队伍 key 集合（O(1) 查找）
    const enemyKeySet = new Set(enemies.map(e => teamKey(e.generals, e.tactics, e.formation)));
    const matrix = {};
    let recProcessed = 0, recMatchedRight = 0, recMatchedLeft = 0;
    for (const rec of recs) {
      const lg = normGens(getGenerals(rec, 'left'));
      const lt = normTacs(getTactics(rec, 'left'));
      const lf = rec.leftFormation  || rec.left_formation  || '';
      const rg = normGens(getGenerals(rec, 'right'));
      const rt = normTacs(getTactics(rec, 'right'));
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
        .sort((a, b) => b.winRate - a.winRate || b.total - a.total);
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

  function addEncounterNoTacs(matrix, enemyKey, cKey, cGens, cWon, cLoss, eLoss, rec) {
    if (!matrix[enemyKey]) matrix[enemyKey] = {};
    if (!matrix[enemyKey][cKey]) {
      matrix[enemyKey][cKey] = {
        generals: cGens,
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

  // 克制推荐（无战法）：所有记录，key 只用武将组合（不区分战法与阵型）
  function analyzeRecommendNoTacs(recs) {
    const enemies = analyzeEnemyFreqNoTacs(recs);
    if (!enemies.length) return [];
    const enemyKeySet = new Set(enemies.map(e => teamKeyNoTacs(e.generals)));
    const matrix = {};
    for (const rec of recs) {
      const lg = normGens(getGenerals(rec, 'left'));
      const rg = normGens(getGenerals(rec, 'right'));
      if (!lg.length || !rg.length) continue;
      const leftKey  = teamKeyNoTacs(lg);
      const rightKey = teamKeyNoTacs(rg);
      const w = winner(rec.result);
      const leftLoss  = parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);
      // 情况一：敌方高频队伍在右侧 → 左侧是潜在克制方
      if (enemyKeySet.has(rightKey)) {
        addEncounterNoTacs(matrix, rightKey, leftKey, normGens(lg).sort(), w === 'left', leftLoss, rightLoss, rec);
      }
      // 情况二：敌方高频队伍在左侧 → 右侧是潜在克制方
      if (leftKey !== rightKey && enemyKeySet.has(leftKey)) {
        addEncounterNoTacs(matrix, leftKey, rightKey, normGens(rg).sort(), w === 'right', rightLoss, leftLoss, rec);
      }
    }
    return enemies.map(enemy => {
      const ek = teamKeyNoTacs(enemy.generals);
      const allCounters = Object.values(matrix[ek] || {});
      const counters = allCounters
        .filter(c => c.wins > 0)
        .map(c => ({
          generals: c.generals,
          records: c.records,
          wins: c.wins,
          winRate:  c.total ? Math.round(c.wins / c.total * 1000) / 10 : 0,
          lossRate: c.enemyLoss ? Math.round(c.counterLoss / c.enemyLoss * 100) : 0,
          total: c.total
        }))
        .sort((a, b) => b.winRate - a.winRate || b.total - a.total);
      return { enemy, counters };
    });
  }

  // ==================== 渲染：Tab 1 克制关系 ====================

  window.renderCounterAnalysis = async function () {
    const el = document.getElementById('counterAnalysisBody');
    if (!el) return;
    await ensureRecords();
    const recs = records();
    let data = analyzeCounter(recs);
    data = caFilterData(data);
    data = caSortData(data);
    window._caCounterData = data;

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="8" class="ca-empty">
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

    // 刷新排序箭头
    document.querySelectorAll('#caPanelRelationship .ca-sort-arrow').forEach(a => {
      a.textContent = '↕'; a.classList.remove('ca-sort-active');
    });
    const th = document.querySelector(`#caPanelRelationship th[data-sort="${caSortField}"]`);
    if (th) {
      const a = th.querySelector('.ca-sort-arrow');
      if (a) { a.textContent = caSortDir === 'asc' ? '▲' : '▼'; a.classList.add('ca-sort-active'); }
    }
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
        <div class="ca-rec-header-mid">克制推荐队伍</div>
        <div class="ca-rec-header-right">
          <span class="ca-rec-sort-btn" onclick="caRecToggleSort('winRate')">胜率 ${caRecSortArrow('winRate')}</span>
          <span class="ca-rec-sort-btn" onclick="caRecToggleSort('lossRate')">战损 ${caRecSortArrow('lossRate')}</span>
          <span class="ca-rec-sort-btn" onclick="caRecToggleSort('total')">场次 ${caRecSortArrow('total')}</span>
          <span class="ca-rec-sort-spacer"></span>
        </div>
      </div>
      ${data.map((item, gi) => {
      const sortedCounters = caRecSortCounters(item.counters);
      item.counters = sortedCounters; // 保持溯源下标与显示顺序一致
      const countersHtml = sortedCounters.length
        ? sortedCounters.map((c, ci) => `
          <div class="ca-rec-counter">
            <div class="ca-rec-counter-team">${teamChip(c.generals, c.tactics, c.formation, true)}</div>
            <div class="ca-rec-counter-stats">
              <div class="ca-stat-item ca-stat-win">${c.winRate}% 胜率</div>
              <div class="ca-stat-item ca-stat-loss">战损 ${c.lossRate}%</div>
              <div class="ca-stat-item ca-stat-cnt">${c.total} 场</div>
              <button class="ca-src-btn" onclick="caShowRecSrc(${gi},${ci})">溯源</button>
            </div>
          </div>`).join('')
        : `<div class="ca-rec-empty">暂无克制数据</div>`;

      return `<div class="ca-rec-group">
        <div class="ca-rec-enemy">
          ${teamChip(item.enemy.generals, item.enemy.tactics, item.enemy.formation, false, {
            html: `<span class="ca-badge ca-badge-cnt">×${item.enemy.count}</span>`,
            cls: 'ca-gen-extra'
          })}
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

  // ==================== 渲染：Tab 4 高频（无战法）====================

  window.renderEnemyHighFreqNoTacs = async function () {
    const el = document.getElementById('enemyHighFreqBodyNoTacs');
    if (!el) return;
    await ensureRecords();
    const data = analyzeEnemyFreqNoTacs(records());

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="3" class="ca-empty">暂无敌方队伍数据</td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => `
      <tr class="ca-row${i < 3 ? ' ca-top3' : ''}">
        <td class="ca-idx ca-rank${i < 3 ? ' ca-rank-top' : ''}">${i + 1}</td>
        <td>${teamChipNoTacs(d.generals, false)}</td>
        <td class="ca-num-cell ca-freq-num">×${d.count}</td>
      </tr>`).join('');
  };

  // ==================== 渲染：Tab 5 克制推荐（无战法）====================

  window.renderCounterRecommendationsNoTacs = async function () {
    const el = document.getElementById('counterRecommendationsNoTacs');
    if (!el) return;
    await ensureRecords();
    const data = analyzeRecommendNoTacs(records());
    window._caRecNTData = data;

    if (!data.length) {
      el.innerHTML = `<div class="ca-empty-blk">暂无克制推荐数据<br><small>需要足够的战报数据才能生成推荐</small></div>`;
      return;
    }

    el.innerHTML = `<div class="ca-rec-header">
        <div class="ca-rec-header-left">敌方高频（无战法）</div>
        <div class="ca-rec-arrow-spacer"></div>
        <div class="ca-rec-header-mid">克制推荐（无战法）</div>
        <div class="ca-rec-header-right">
          <span class="ca-rec-sort-btn" onclick="caRecNTToggleSort('winRate')">胜率 ${caRecNTSortArrow('winRate')}</span>
          <span class="ca-rec-sort-btn" onclick="caRecNTToggleSort('lossRate')">战损 ${caRecNTSortArrow('lossRate')}</span>
          <span class="ca-rec-sort-btn" onclick="caRecNTToggleSort('total')">场次 ${caRecNTSortArrow('total')}</span>
          <span class="ca-rec-sort-spacer"></span>
        </div>
      </div>
      ${data.map((item, gi) => {
      const sortedCounters = caRecNTSortCounters(item.counters);
      item.counters = sortedCounters; // 保持溯源下标与显示顺序一致
      const countersHtml = sortedCounters.length
        ? sortedCounters.map((c, ci) => `
          <div class="ca-rec-counter">
            <div class="ca-rec-counter-team">${teamChipNoTacs(c.generals, true)}</div>
            <div class="ca-rec-counter-stats">
              <div class="ca-stat-item ca-stat-win">${c.winRate}% 胜率</div>
              <div class="ca-stat-item ca-stat-loss">战损 ${c.lossRate}%</div>
              <div class="ca-stat-item ca-stat-cnt">${c.total} 场</div>
              <button class="ca-src-btn" onclick="caShowRecSrcNT(${gi},${ci})">溯源</button>
            </div>
          </div>`).join('')
        : `<div class="ca-rec-empty">暂无克制数据</div>`;

      return `<div class="ca-rec-group">
        <div class="ca-rec-enemy">
          ${teamChipNoTacs(item.enemy.generals, false, {
            html: `<span class="ca-badge ca-badge-cnt">×${item.enemy.count}</span>`,
            cls: 'ca-gen-extra'
          })}
        </div>
        <div class="ca-rec-arrow">▶</div>
        <div class="ca-rec-counters">${countersHtml}</div>
      </div>`;
    }).join('')}`;
  };

  window.caShowRecSrcNT = function (gi, ci) {
    const d = (window._caRecNTData || [])[gi];
    if (d && d.counters[ci]) showImageSource(d.counters[ci].records);
  };

  // ==================== 导出打印 ====================

  function caGetPrintStyles() {
    // 从当前页面读取 CSS 变量，保持原始深色主题
    const rs = getComputedStyle(document.documentElement);
    const varNames = ['--bg','--bg2','--bg3','--text','--text2','--text3','--border','--accent','--green','--red'];
    const vars = varNames.map(v => {
      const val = rs.getPropertyValue(v).trim();
      return val ? `${v}:${val}` : '';
    }).filter(Boolean).join(';');

    // 复制页面中已注入的 CA 样式
    const caStyleEl = document.getElementById('ca-styles');
    const caStyles = caStyleEl ? caStyleEl.textContent : '';

    return `
      :root{${vars}}
      *{box-sizing:border-box;}
      body{background:var(--bg,#0a0a1a);color:var(--text,#ddd);font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;padding:20px;margin:0;}
      h2{font-size:15px;color:var(--text,#ddd);margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--accent,#5b4fff);}
      ${caStyles}
      .ca-src-btn,.ca-filter-row,.ca-sort-arrow,.ca-rec-sort-btn,.ca-rec-sort-spacer,.ca-th-act,.ca-hint-row-export,td.ca-center{display:none!important;}
      @media print{body{padding:10px;}@page{margin:12mm;}}
    `;
  }

  window.caExportTab = function (tab) {
    const panelMap = {
      relationship:    { id: 'caPanelRelationship',    title: '克制关系分析' },
      enemy:           { id: 'caPanelEnemy',           title: '敌方高频队伍' },
      recommend:       { id: 'caPanelRecommend',       title: '克制推荐' },
      enemyNoTacs:     { id: 'caPanelEnemyNoTacs',     title: '敌方高频（无战法）' },
      recommendNoTacs: { id: 'caPanelRecommendNoTacs', title: '克制推荐（无战法）' },
    };
    const cfg = panelMap[tab];
    if (!cfg) return;
    const panel = document.getElementById(cfg.id);
    if (!panel) return;

    const clone = panel.cloneNode(true);
    clone.querySelectorAll('.ca-hint-row-export').forEach(el => el.remove());

    const win = window.open('', '_blank', 'width=980,height=760');
    if (!win) { alert('请允许浏览器弹出窗口后重试'); return; }
    win.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${escHtml(cfg.title)}</title>
<style>${caGetPrintStyles()}</style>
</head>
<body>
<h2>${escHtml(cfg.title)}</h2>
${clone.innerHTML}
<script>window.onload=function(){window.print();}<\/script>
</body></html>`);
    win.document.close();
  };

  // ==================== UI 框架 ====================

  window.createCounterAnalysisUI = async function (parent) {
    injectStyles();

    parent.innerHTML = `
      <div class="ca-root">
        <div class="ca-tabs">
          <button class="ca-tab active" onclick="switchCounterTab('relationship')" id="caTabRelBtn">克制关系</button>
          <button class="ca-tab" onclick="switchCounterTab('enemy')" id="caTabEnemyBtn">敌方高频（有战法）</button>
          <button class="ca-tab" onclick="switchCounterTab('recommend')" id="caTabRecBtn">克制推荐（有战法）</button>
          <button class="ca-tab" onclick="switchCounterTab('enemyNoTacs')" id="caTabEnemyNTBtn">敌方高频（无战法）</button>
          <button class="ca-tab" onclick="switchCounterTab('recommendNoTacs')" id="caTabRecNTBtn">克制推荐（无战法）</button>
        </div>

        <div id="caPanelRelationship">
          <div class="ca-hint-row"><p class="ca-hint">双方队伍（武将＋战法＋阵型均相同）即可统计，胜率高者显示在左侧</p><button class="ca-hint-row-export" onclick="caExportTab('relationship')">⬇ 导出打印</button></div>
          <div class="ca-filter-row">
            <input id="caSearchWinner" placeholder="🔍 胜方：武将/战法/阵型" oninput="renderCounterAnalysis()" style="flex:1;min-width:140px;font-size:11px;padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;">
            <input id="caSearchLoser" placeholder="🔍 对手：武将/战法/阵型" oninput="renderCounterAnalysis()" style="flex:1;min-width:140px;font-size:11px;padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;">
            <button onclick="caClearFilters()" style="font-size:11px;padding:5px 10px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);border-radius:4px;cursor:pointer;white-space:nowrap;">清除</button>
          </div>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th class="ca-th-idx">#</th>
                <th class="ca-th-team">胜方队伍</th>
                <th class="ca-th-vs"></th>
                <th class="ca-th-team">对手队伍</th>
                <th class="ca-th-num ca-sortable" data-sort="total" onclick="caToggleSort('total')">场次 ${caSortArrow('total')}</th>
                <th class="ca-th-num ca-sortable" data-sort="leftWR" onclick="caToggleSort('leftWR')">胜率 ${caSortArrow('leftWR')}</th>
                <th class="ca-th-num ca-sortable" data-sort="lossRate" onclick="caToggleSort('lossRate')">战损比 ${caSortArrow('lossRate')}</th>
                <th class="ca-th-act">溯源</th>
              </tr></thead>
              <tbody id="counterAnalysisBody"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelEnemy" style="display:none;">
          <div class="ca-hint-row"><p class="ca-hint">敌方（右侧）队伍出场频率 TOP 30，武将＋战法＋阵型相同视为同一队伍</p><button class="ca-hint-row-export" onclick="caExportTab('enemy')">⬇ 导出打印</button></div>
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
          <div class="ca-hint-row"><p class="ca-hint">针对敌方高频队伍，从所有战报中找出有过战胜记录（胜率 &gt;50%）的克制阵容，按胜率降序</p><button class="ca-hint-row-export" onclick="caExportTab('recommend')">⬇ 导出打印</button></div>
          <div id="counterRecommendations"></div>
        </div>

        <div id="caPanelEnemyNoTacs" style="display:none;">
          <div class="ca-hint-row"><p class="ca-hint">敌方（右侧）队伍出场频率，仅以武将组合区分，不区分战法与阵型，全部显示</p><button class="ca-hint-row-export" onclick="caExportTab('enemyNoTacs')">⬇ 导出打印</button></div>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th class="ca-th-idx">#</th>
                <th>队伍（武将组合）</th>
                <th class="ca-th-num">出场</th>
              </tr></thead>
              <tbody id="enemyHighFreqBodyNoTacs"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelRecommendNoTacs" style="display:none;">
          <div class="ca-hint-row"><p class="ca-hint">针对高频武将组合，找出有战胜记录的克制武将组合（不区分战法与阵型），至少1胜，全部显示</p><button class="ca-hint-row-export" onclick="caExportTab('recommendNoTacs')">⬇ 导出打印</button></div>
          <div id="counterRecommendationsNoTacs"></div>
        </div>
      </div>`;

    switchCounterTab('relationship');
  };

  window.switchCounterTab = async function (tab) {
    const panels = {
      relationship:    'caPanelRelationship',
      enemy:           'caPanelEnemy',
      recommend:       'caPanelRecommend',
      enemyNoTacs:     'caPanelEnemyNoTacs',
      recommendNoTacs: 'caPanelRecommendNoTacs'
    };
    const btns = {
      relationship:    'caTabRelBtn',
      enemy:           'caTabEnemyBtn',
      recommend:       'caTabRecBtn',
      enemyNoTacs:     'caTabEnemyNTBtn',
      recommendNoTacs: 'caTabRecNTBtn'
    };
    Object.keys(panels).forEach(t => {
      const p = document.getElementById(panels[t]);
      const b = document.getElementById(btns[t]);
      if (p) p.style.display = t === tab ? 'block' : 'none';
      if (b) b.classList.toggle('active', t === tab);
    });
    if (tab === 'relationship')    await renderCounterAnalysis();
    else if (tab === 'enemy')      await renderEnemyHighFreq();
    else if (tab === 'recommend')  await renderCounterRecommendations();
    else if (tab === 'enemyNoTacs') await renderEnemyHighFreqNoTacs();
    else                           await renderCounterRecommendationsNoTacs();
  };

  // ==================== 样式注入 ====================

  function injectStyles() {
    if (document.getElementById('ca-styles')) return;
    const s = document.createElement('style');
    s.id = 'ca-styles';
    s.textContent = `
      /* ---- 根容器 ---- */
      .ca-root{padding:16px;}

      /* ---- 导出按钮行 ---- */
      .ca-hint-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;}
      .ca-hint-row .ca-hint{margin:0;}
      .ca-hint-row-export{flex-shrink:0;padding:3px 10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:4px;color:#888;font-size:11px;cursor:pointer;white-space:nowrap;transition:all .15s;}
      .ca-hint-row-export:hover{background:rgba(255,255,255,.13);color:#ccc;border-color:rgba(255,255,255,.28);}

      /* ---- tabs ---- */
      .ca-tabs{display:flex;gap:2px;margin-bottom:14px;border-bottom:1px solid var(--border,#2a2a3e);}
      .ca-tab{padding:6px 18px;border:none;border-radius:6px 6px 0 0;background:transparent;
        color:#666;cursor:pointer;font-size:12px;transition:all .15s;letter-spacing:.03em;}
      .ca-tab.active{background:var(--accent,#5b4fff);color:#fff;font-weight:600;}
      .ca-tab:hover:not(.active){color:#aaa;background:rgba(255,255,255,.04);}
      .ca-hint{color:#555;font-size:11px;margin:0 0 10px;line-height:1.6;}

      /* ---- 筛选行 ---- */
      .ca-filter-row{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}

      /* ---- 可排序表头 ---- */
      .ca-sortable{cursor:pointer;user-select:none;}
      .ca-sortable:hover{color:#ccc;}
      .ca-sort-arrow{font-size:10px;margin-left:2px;color:#555;}
      .ca-sort-active{color:var(--accent,#5b4fff) !important;}

      /* ---- 通用表格 ---- */
      .ca-tbl-wrap{overflow-x:auto;border:1px solid var(--border,#2a2a3e);border-radius:8px;}
      .ca-tbl{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;}
      .ca-tbl th{padding:7px 10px;text-align:center;border-bottom:1px solid var(--border,#2a2a3e);
        color:#666;background:var(--bg2,#111122);font-weight:500;white-space:nowrap;}
      .ca-row td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle;}
      .ca-row:last-child td{border-bottom:none;}
      .ca-row:hover td{background:rgba(255,255,255,.025);}

      /* Tab1 列宽 — 窄列固定比例，队伍列均分剩余 */
      .ca-th-idx{width:4%;text-align:center;}
      .ca-th-vs{width:4%;text-align:center;}
      .ca-th-num{width:9%;text-align:center;}
      .ca-th-act{width:7%;text-align:center;}
      .ca-th-team{text-align:left;}

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
      .ca-tac{display:inline-block;width:50px;text-align:center;font-size:10px;padding:1px 0;border-radius:3px;white-space:nowrap;
        background:rgba(91,79,255,.12);color:#9d8fff;border:1px solid rgba(91,79,255,.2);}
      .ca-form-badge{font-size:10px;padding:1px 6px;border-radius:3px;white-space:nowrap;flex-shrink:0;
        background:rgba(245,197,66,.1);color:#f5c542;border:1px solid rgba(245,197,66,.2);}
      .ca-dot{color:#333;margin:0 1px;font-size:10px;}
      .ca-dim{color:#444;font-size:11px;}
      .ca-gen-table{width:100%;table-layout:fixed;border-collapse:collapse;}
      .ca-gen-row td{padding:0 0 2px 0;vertical-align:middle;}
      .ca-gen-row:last-child td{padding-bottom:0;}
      .ca-gen-name{width:20%;padding-right:6px;white-space:nowrap;font-size:12px;}
      .ca-gen-tacs{width:40%;line-height:1.4;text-align:left;}
      .ca-gen-form{width:20%;text-align:center;vertical-align:middle;}
      .ca-gen-extra{width:20%;text-align:center;vertical-align:middle;padding-left:8px;}
      .ca-tac-sep{color:#555;margin:0 1px;font-size:9px;}

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
        border-radius:8px 8px 0 0;padding:8px 14px;margin-bottom:0;font-weight:600;font-size:12px;
        color:var(--accent,#f0b429);letter-spacing:.04em;}
      .ca-rec-header-left{flex:0 0 33.333%;min-width:0;text-align:center;}
      .ca-rec-header-mid{flex:1 1 0;min-width:0;text-align:center;}
      .ca-rec-header-right{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:4px;}
      .ca-rec-arrow-spacer{flex:0 0 26px;}
      .ca-rec-group{display:flex;align-items:stretch;
        background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);
        border-top:none;border-radius:0;margin-bottom:0;overflow:hidden;}
      .ca-rec-group:last-child{border-radius:0 0 8px 8px;margin-bottom:8px;}
      .ca-rec-enemy{flex:0 0 33.333%;min-width:0;padding:12px 14px;
        border-right:1px solid var(--border,#2a2a3e);
        display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,.01);}
      .ca-rec-arrow{flex:0 0 26px;display:flex;align-items:center;justify-content:center;
        color:#333;font-size:11px;}
      .ca-rec-counters{flex:1 1 0;min-width:0;display:flex;flex-direction:column;}
      .ca-rec-counter{display:flex;align-items:stretch;
        padding:0;border-bottom:1px solid rgba(255,255,255,.04);}
      .ca-rec-counter:last-child{border-bottom:none;}
      .ca-rec-counter-team{flex:1 1 0;min-width:0;padding:10px 14px;
        border-right:1px solid rgba(255,255,255,.04);}
      .ca-rec-counter-stats{flex:1 1 0;min-width:0;padding:6px 6px;
        display:flex;align-items:stretch;gap:4px;}
      .ca-rec-empty{color:var(--text3,#888);font-size:12px;padding:16px 14px;font-style:italic;}
      .ca-stat-item{flex:1 1 0;min-width:0;font-size:13px;white-space:nowrap;text-align:center;
        padding:6px 4px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-weight:600;}
      .ca-stat-win{color:#2ecc71;background:rgba(39,174,96,.12);}
      .ca-stat-loss{color:#4a90d9;background:rgba(74,144,217,.12);}
      .ca-stat-cnt{color:#aaa;background:rgba(255,255,255,.06);}
      .ca-rec-counter-stats .ca-src-btn{flex:1 1 0;min-width:0;text-align:center;}
	      .ca-rec-sort-btn{flex:1 1 0;min-width:0;cursor:pointer;user-select:none;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;text-align:center;}
	      .ca-rec-sort-btn:hover{background:rgba(255,255,255,.06);color:#ccc;}
	      .ca-rec-sort-spacer{flex:1 1 0;min-width:0;}
    `;
    document.head.appendChild(s);
  }

})();

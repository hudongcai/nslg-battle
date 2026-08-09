/**
 * 克制分析模块 v20260621001
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

  function records() {
    // 使用时间过滤后的数据（如果过滤功能可用）
    if (typeof window.getFilteredRecordsForWinrate === 'function') {
      return window.getFilteredRecordsForWinrate();
    }
    return window.allRecords || [];
  }

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

  // ---- 平均红度筛选状态（0~5 均已选中） ----
  let caEnemyNTStarsFilter  = new Set([0,1,2,3,4,5]); // 敌方高频队伍统计 tab
  let caRecNTEnemyStarsFilter   = new Set([0,1,2,3,4,5]); // 胜率分析 tab - 敌方侧
  let caRecNTCounterStarsFilter = new Set([0,1,2,3,4,5]); // 胜率分析 tab - 克制侧

  // 计算一组 stars 数组的平均值并取整（0~5）
  function avgStarsRounded(avgStars) {
    return Math.round(Math.max(0, Math.min(5, avgStars || 0)));
  }

  // 生成复选框 HTML（用于静态 HTML 区域，初始全选）
  function caStarsCheckboxHtml(filterId) {
    const boxes = [0,1,2,3,4,5].map(v =>
      `<label style="display:inline-flex;align-items:center;gap:2px;font-size:11px;color:#aaa;cursor:pointer;white-space:nowrap;"><input type="checkbox" id="${filterId}_star${v}" checked onchange="caStarsFilterChange('${filterId}',${v},this.checked)" style="cursor:pointer;margin:0;width:12px;height:12px;"><span>${v}</span></label>`
    ).join('');
    return boxes + `<button onclick="caStarsFilterAll('${filterId}')" class="ca-stars-btn">全选</button><button onclick="caStarsFilterInvert('${filterId}')" class="ca-stars-btn">反选</button>`;
  }

  // 生成复选框 HTML（用于动态渲染区域，根据 Set 状态设置 checked）
  function caStarsCheckboxHtmlDynamic(filterId, filterSet) {
    const boxes = [0,1,2,3,4,5].map(v =>
      `<label style="display:inline-flex;align-items:center;gap:2px;font-size:11px;color:#aaa;cursor:pointer;white-space:nowrap;"><input type="checkbox" ${filterSet.has(v) ? 'checked' : ''} onchange="caStarsFilterChange('${filterId}',${v},this.checked)" style="cursor:pointer;margin:0;width:12px;height:12px;"><span>${v}</span></label>`
    ).join('');
    return boxes + `<button onclick="caStarsFilterAll('${filterId}')" class="ca-stars-btn">全选</button><button onclick="caStarsFilterInvert('${filterId}')" class="ca-stars-btn">反选</button>`;
  }

  window.caStarsFilterChange = function(id, val, checked) {
    const set = id === 'efnt' ? caEnemyNTStarsFilter
              : id === 'recnt_e' ? caRecNTEnemyStarsFilter
              : caRecNTCounterStarsFilter;
    if (checked) set.add(val); else set.delete(val);
    if (id === 'efnt') renderEnemyHighFreqNoTacs();
    else renderCounterRecommendationsNoTacs();
  };

  window.caStarsFilterAll = function(id) {
    const set = id === 'efnt' ? caEnemyNTStarsFilter
              : id === 'recnt_e' ? caRecNTEnemyStarsFilter
              : caRecNTCounterStarsFilter;
    [0,1,2,3,4,5].forEach(v => set.add(v));
    if (id === 'efnt') {
      [0,1,2,3,4,5].forEach(v => { const el = document.getElementById(`efnt_star${v}`); if (el) el.checked = true; });
      renderEnemyHighFreqNoTacs();
    } else { renderCounterRecommendationsNoTacs(); }
  };

  window.caStarsFilterInvert = function(id) {
    const set = id === 'efnt' ? caEnemyNTStarsFilter
              : id === 'recnt_e' ? caRecNTEnemyStarsFilter
              : caRecNTCounterStarsFilter;
    [0,1,2,3,4,5].forEach(v => { if (set.has(v)) set.delete(v); else set.add(v); });
    if (id === 'efnt') {
      [0,1,2,3,4,5].forEach(v => { const el = document.getElementById(`efnt_star${v}`); if (el) el.checked = set.has(v); });
      renderEnemyHighFreqNoTacs();
    } else { renderCounterRecommendationsNoTacs(); }
  };

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
      if (!stats[k]) stats[k] = { generals: normGens(rg).sort(), count: 0, starsSum: 0, starsCount: 0 };
      stats[k].count++;
      const s1 = rec.rightGeneral1Stars || rec.right_general_1_stars || 0;
      const s2 = rec.rightGeneral2Stars || rec.right_general_2_stars || 0;
      const s3 = rec.rightGeneral3Stars || rec.right_general_3_stars || 0;
      stats[k].starsSum += (+s1) + (+s2) + (+s3);
      stats[k].starsCount += 3;
    }
    return Object.values(stats).sort((a, b) => b.count - a.count).map(d => ({
      ...d,
      avgStars: d.starsCount > 0 ? d.starsSum / d.starsCount : 0
    }));
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

  function addEncounterNoTacs(matrix, enemyKey, cKey, cGens, cWon, cLoss, eLoss, rec, cStars) {
    if (!matrix[enemyKey]) matrix[enemyKey] = {};
    if (!matrix[enemyKey][cKey]) {
      matrix[enemyKey][cKey] = {
        generals: cGens,
        wins: 0, total: 0, counterLoss: 0, enemyLoss: 0, records: [],
        starsSum: 0, starsCount: 0
      };
    }
    const c = matrix[enemyKey][cKey];
    c.total++;
    if (cWon) c.wins++;
    c.counterLoss += cLoss;
    c.enemyLoss  += eLoss;
    c.records.push(rec);
    if (cStars) {
      c.starsSum  += (+cStars[0] || 0) + (+cStars[1] || 0) + (+cStars[2] || 0);
      c.starsCount += 3;
    }
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
      if (leftKey === rightKey) continue; // 跳过自打自，防止队伍成为自身克制推荐
      const w = winner(rec.result);
      const leftLoss  = parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);
      const leftStars  = [rec.leftGeneral1Stars  || rec.left_general_1_stars  || 0,
                          rec.leftGeneral2Stars  || rec.left_general_2_stars  || 0,
                          rec.leftGeneral3Stars  || rec.left_general_3_stars  || 0];
      const rightStars = [rec.rightGeneral1Stars || rec.right_general_1_stars || 0,
                          rec.rightGeneral2Stars || rec.right_general_2_stars || 0,
                          rec.rightGeneral3Stars || rec.right_general_3_stars || 0];
      // 情况一：敌方高频队伍在右侧 → 左侧是潜在克制方
      if (enemyKeySet.has(rightKey)) {
        addEncounterNoTacs(matrix, rightKey, leftKey, normGens(lg).sort(), w === 'left', leftLoss, rightLoss, rec, leftStars);
      }
      // 情况二：敌方高频队伍在左侧 → 右侧是潜在克制方
      if (enemyKeySet.has(leftKey)) {
        addEncounterNoTacs(matrix, leftKey, rightKey, normGens(rg).sort(), w === 'right', rightLoss, leftLoss, rec, rightStars);
      }
    }
    return enemies.map(enemy => {
      const ek = teamKeyNoTacs(enemy.generals);
      const allCounters = Object.values(matrix[ek] || {});
      const counters = allCounters
        .map(c => ({
          generals: c.generals,
          records: c.records,
          wins: c.wins,
          winRate:  c.total ? Math.round(c.wins / c.total * 1000) / 10 : 0,
          lossRate: c.enemyLoss ? Math.round(c.counterLoss / c.enemyLoss * 100) : 0,
          total: c.total,
          avgStars: c.starsCount > 0 ? c.starsSum / c.starsCount : 0
        }))
        .sort((a, b) => b.winRate - a.winRate || b.total - a.total);
      return { enemy, counters };
    });
  }

  // ==================== 分析：矩阵 敌方克制分析矩阵 ====================

  function analyzeCounterMatrix(recs) {
    const allEnemies = analyzeEnemyFreqNoTacs(recs);
    const top10 = allEnemies.slice(0, 10);
    if (!top10.length) return { top10: [], top10Keys: [], ourTeams: [], matrix: {} };

    const top10Keys = top10.map(e => teamKeyNoTacs(e.generals));
    const top10KeySet = new Set(top10Keys);

    const matrix = {};     // matrix[ourKey][enemyKey] = { wins, total, counterLoss, enemyLoss, records }
    const ourTeamMap = {}; // ourKey -> { generals, total }

    for (const rec of recs) {
      const lg = normGens(getGenerals(rec, 'left'));
      const rg = normGens(getGenerals(rec, 'right'));
      if (!lg.length || !rg.length) continue;

      const leftKey  = teamKeyNoTacs(lg);
      const rightKey = teamKeyNoTacs(rg);
      const w = winner(rec.result);
      const leftLoss  = parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);

      if (top10KeySet.has(rightKey)) {
        if (!matrix[leftKey]) matrix[leftKey] = {};
        if (!matrix[leftKey][rightKey]) matrix[leftKey][rightKey] = { wins: 0, total: 0, counterLoss: 0, enemyLoss: 0, records: [] };
        matrix[leftKey][rightKey].wins += (w === 'left') ? 1 : (w === 'draw') ? 0.5 : 0;
        matrix[leftKey][rightKey].total++;
        matrix[leftKey][rightKey].counterLoss += leftLoss;
        matrix[leftKey][rightKey].enemyLoss   += rightLoss;
        matrix[leftKey][rightKey].records.push(rec);
        if (!ourTeamMap[leftKey]) ourTeamMap[leftKey] = { generals: normGens(lg).sort(), total: 0 };
        ourTeamMap[leftKey].total++;
      }

      if (top10KeySet.has(leftKey) && leftKey !== rightKey) {
        if (!matrix[rightKey]) matrix[rightKey] = {};
        if (!matrix[rightKey][leftKey]) matrix[rightKey][leftKey] = { wins: 0, total: 0, counterLoss: 0, enemyLoss: 0, records: [] };
        matrix[rightKey][leftKey].wins += (w === 'right') ? 1 : (w === 'draw') ? 0.5 : 0;
        matrix[rightKey][leftKey].total++;
        matrix[rightKey][leftKey].counterLoss += rightLoss;
        matrix[rightKey][leftKey].enemyLoss   += leftLoss;
        matrix[rightKey][leftKey].records.push(rec);
        if (!ourTeamMap[rightKey]) ourTeamMap[rightKey] = { generals: normGens(rg).sort(), total: 0 };
        ourTeamMap[rightKey].total++;
      }
    }

    const ourTeams = Object.entries(ourTeamMap)
      .map(([k, v]) => ({ key: k, generals: v.generals, total: v.total }))
      .sort((a, b) => b.total - a.total);

    return { top10, top10Keys, ourTeams, matrix };
  }

  // ==================== 分析：玩家胜率排行榜 ====================

  function analyzePlayerLeaderboard(recs) {
    const players = {};

    function addEntry(pName, gens, tacs, form, side, rec, w) {
      if (!pName || !gens.length) return;
      if (!players[pName]) players[pName] = { name: pName, totalBattles: 0, totalWins: 0, teams: {} };
      const p = players[pName];
      p.totalBattles++;
      const wonScore = w === side ? 1 : w === 'draw' ? 0.5 : 0;
      p.totalWins += wonScore;
      const tk = teamKey(gens, tacs, form);
      if (!p.teams[tk]) p.teams[tk] = { generals: gens, tactics: tacs, formation: form, battles: 0, wins: 0, records: [], sides: [] };
      p.teams[tk].battles++;
      p.teams[tk].wins += wonScore;
      p.teams[tk].records.push(rec);
      p.teams[tk].sides.push(side);
    }

    for (const rec of recs) {
      const lp = (rec.leftPlayer || '').trim();
      const rp = (rec.rightPlayer || '').trim();
      const lg = normGens(getGenerals(rec, 'left'));
      const lt = normTacs(getTactics(rec, 'left'));
      const lf = rec.leftFormation || rec.left_formation || '';
      const rg = normGens(getGenerals(rec, 'right'));
      const rt = normTacs(getTactics(rec, 'right'));
      const rf = rec.rightFormation || rec.right_formation || '';
      const w = winner(rec.result);
      addEntry(lp, lg, lt, lf, 'left', rec, w);
      addEntry(rp, rg, rt, rf, 'right', rec, w);
    }

    return Object.values(players)
      .map(p => ({
        name: p.name,
        totalBattles: p.totalBattles,
        totalWins: p.totalWins,
        avgWinRate: p.totalBattles > 0 ? Math.round(p.totalWins / p.totalBattles * 1000) / 10 : 0,
        teamList: Object.values(p.teams)
          .map(t => ({
            generals: t.generals, tactics: t.tactics, formation: t.formation,
            battles: t.battles, wins: t.wins, records: t.records, sides: t.sides,
            winRate: t.battles > 0 ? Math.round(t.wins / t.battles * 1000) / 10 : 0
          }))
          .sort((a, b) => b.winRate - a.winRate || b.battles - a.battles)
      }))
      .sort((a, b) => b.avgWinRate - a.avgWinRate || b.totalBattles - a.totalBattles);
  }

  // ==================== 分析：Tab 6 综合推荐队伍 ====================

  function addBestEncounter(matrix, ek, ck, generals, cWon, cLoss, eLoss, rec) {
    if (!matrix[ek]) matrix[ek] = {};
    if (!matrix[ek][ck]) {
      matrix[ek][ck] = { generals, wins: 0, total: 0, counterLossSum: 0, enemyLossSum: 0, records: [] };
    }
    const c = matrix[ek][ck];
    c.total++;
    if (cWon) c.wins++;
    c.counterLossSum += cLoss;
    c.enemyLossSum   += eLoss;
    c.records.push(rec);
  }

  function analyzeBestRecommendation(recs) {
    // Step 1: 统计右侧（敌方）高频武将组合，仅按武将区分，取 Top 10
    const enemyStats = {};
    for (const rec of recs) {
      const rg = normGens(getGenerals(rec, 'right'));
      if (!rg.length) continue;
      const k = teamKeyNoTacs(rg);
      if (!enemyStats[k]) enemyStats[k] = { generals: normGens(rg).sort(), count: 0 };
      enemyStats[k].count++;
    }
    const top10 = Object.values(enemyStats).sort((a, b) => b.count - a.count).slice(0, 10);
    const totalCount = top10.reduce((s, e) => s + e.count, 0);
    if (!top10.length || !totalCount) return null;

    const enemyKeySet = new Set(top10.map(e => teamKeyNoTacs(e.generals)));

    // Step 2: 遍历战报，构建对战矩阵 matrix[enemyKey][counterKey]
    const matrix = {};
    for (const rec of recs) {
      const lg = normGens(getGenerals(rec, 'left'));
      const rg = normGens(getGenerals(rec, 'right'));
      if (!lg.length || !rg.length) continue;
      const lk = teamKeyNoTacs(lg);
      const rk = teamKeyNoTacs(rg);
      if (lk === rk) continue; // 同队不比较
      const w = winner(rec.result);
      const leftLoss  = parseFloat(rec.leftLoss  || rec.left_loss  || 0);
      const rightLoss = parseFloat(rec.rightLoss || rec.right_loss || 0);

      // 敌方在右侧 → 左侧是克制方，左胜=克制方胜
      if (enemyKeySet.has(rk)) {
        addBestEncounter(matrix, rk, lk, normGens(lg).sort(), w === 'left', leftLoss, rightLoss, rec);
      }
      // 敌方在左侧 → 右侧是克制方，右胜=克制方胜（即左败）
      if (enemyKeySet.has(lk)) {
        addBestEncounter(matrix, lk, rk, normGens(rg).sort(), w === 'right', rightLoss, leftLoss, rec);
      }
    }

    // Step 3: 收集所有出现过的克制方 key
    const counterKeySet = new Set();
    for (const ek of Object.keys(matrix)) {
      for (const ck of Object.keys(matrix[ek])) counterKeySet.add(ck);
    }

    // Step 4: 计算每支克制队伍的价值分
    const counterList = [];
    for (const ck of counterKeySet) {
      let totalScore = 0;
      const details = [];
      let generalsRef = null;

      for (let i = 0; i < top10.length; i++) {
        const enemy = top10[i];
        const ek = teamKeyNoTacs(enemy.generals);
        if (ck === ek) continue; // 同队不比较

        const data = matrix[ek] && matrix[ek][ck];
        const weight = enemy.count / totalCount;

        let battles = 0, wins = 0, winRate = 0.5, isDefault = true;
        let avgLossC = 0, avgLossE = 0, lossRate = null;
        let detailRecords = [];

        if (data && data.total > 0) {
          battles        = data.total;
          wins           = data.wins;
          winRate        = data.wins / data.total;
          isDefault      = false;
          avgLossC       = data.counterLossSum / data.total;
          avgLossE       = data.enemyLossSum   / data.total;
          lossRate       = avgLossE > 0 ? avgLossC / avgLossE : null;
          detailRecords  = data.records;
          generalsRef    = data.generals;
        }

        const scoreContrib = weight * winRate;
        totalScore += scoreContrib;

        details.push({
          enemyIdx: i,
          enemy: enemy.generals,
          enemyCount: enemy.count,
          battles, wins, winRate, isDefault,
          avgLossC, avgLossE, lossRate,
          records: detailRecords,
          scoreContrib
        });
      }

      // 按对战得分降序排列细节
      details.sort((a, b) => b.scoreContrib - a.scoreContrib);

      const generals = generalsRef || ck.split('|');
      counterList.push({ key: ck, generals, score: totalScore, details });
    }

    counterList.sort((a, b) => b.score - a.score);
    // 克制队伍不能和敌方高频队伍相同（自身不能推荐自己）
    const filteredCounters = counterList.filter(c => !enemyKeySet.has(c.key));
    return { enemies: top10, totalCount, counters: filteredCounters };
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

  // ==================== 渲染：Tab 1 敌方高频队伍统计（无战法）====================

  window.renderEnemyHighFreqNoTacs = async function () {
    const el = document.getElementById('enemyHighFreqBodyNoTacs');
    if (!el) return;
    await ensureRecords();
    const allData = analyzeEnemyFreqNoTacs(records());
    const totalRecords = records().length;

    // 应用平均红度筛选
    const data = allData.filter(d => caEnemyNTStarsFilter.has(avgStarsRounded(d.avgStars)));

    if (!data.length) {
      el.innerHTML = `<tr><td colspan="4" class="ca-empty">暂无敌方队伍数据</td></tr>`;
      return;
    }

    el.innerHTML = data.map((d, i) => {
      const pct = totalRecords > 0 ? (d.count / totalRecords * 100).toFixed(1) : '0.0';
      return `<tr class="ca-row${i < 3 ? ' ca-top3' : ''}">
        <td class="ca-idx ca-rank${i < 3 ? ' ca-rank-top' : ''}">${i + 1}</td>
        <td>${teamChipNoTacs(d.generals, false)}</td>
        <td class="ca-num-cell ca-freq-num">${d.count}</td>
        <td class="ca-num-cell" style="color:#aaa;">${pct}%</td>
      </tr>`;
    }).join('');
  };

  // ==================== 渲染：Tab 2 敌方高频胜率分析（无战法）====================

  window.renderCounterRecommendationsNoTacs = async function () {
    const el = document.getElementById('counterRecommendationsNoTacs');
    if (!el) return;
    await ensureRecords();
    const allData = analyzeRecommendNoTacs(records());

    if (!allData.length) {
      el.innerHTML = `<div class="ca-empty-blk">暂无数据<br><small>需要足够的战报数据才能生成分析</small></div>`;
      return;
    }

    // 应用敌方侧平均红度筛选
    const data = allData.filter(item =>
      caRecNTEnemyStarsFilter.has(avgStarsRounded(item.enemy.avgStars))
    );

    window._caRecNTData = data;

    const enemyFilterHtml = caStarsCheckboxHtmlDynamic('recnt_e', caRecNTEnemyStarsFilter);
    const counterFilterHtml = caStarsCheckboxHtmlDynamic('recnt_c', caRecNTCounterStarsFilter);

    el.innerHTML = `<div class="ca-rec-header">
        <div class="ca-rec-header-left">敌方高频队伍</div>
        <div class="ca-rec-arrow-spacer"></div>
        <div class="ca-rec-header-mid">对战胜率分析</div>
        <div class="ca-rec-header-right">
          <span class="ca-rec-sort-btn" onclick="caRecNTToggleSort('winRate')">胜率 ${caRecNTSortArrow('winRate')}</span>
          <span class="ca-rec-sort-btn" onclick="caRecNTToggleSort('lossRate')">战损 ${caRecNTSortArrow('lossRate')}</span>
          <span class="ca-rec-sort-btn" onclick="caRecNTToggleSort('total')">场次 ${caRecNTSortArrow('total')}</span>
          <span class="ca-rec-sort-spacer"></span>
        </div>
      </div>
      <div class="ca-rec-sub-filter">
        <div class="ca-rec-sub-filter-col">
          <span style="font-size:11px;color:#777;white-space:nowrap;flex-shrink:0;">均红：</span>
          ${enemyFilterHtml}
        </div>
        <div style="flex:0 0 26px;" class="ca-rec-sub-filter-spacer"></div>
        <div class="ca-rec-sub-filter-col">
          <span style="font-size:11px;color:#777;white-space:nowrap;flex-shrink:0;">均红：</span>
          ${counterFilterHtml}
        </div>
      </div>
      ${data.length === 0 ? `<div class="ca-empty-blk">当前筛选条件下无数据</div>` :
        data.map((item, gi) => {
          const filteredCounters = item.counters.filter(c =>
            caRecNTCounterStarsFilter.has(avgStarsRounded(c.avgStars))
          );
          const sortedCounters = caRecNTSortCounters(filteredCounters);
          item.counters = sortedCounters;
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
            : `<div class="ca-rec-empty">暂无克制数据（或被红度筛选过滤）</div>`;

          return `<div class="ca-rec-group">
            <div class="ca-rec-enemy">
              ${teamChipNoTacs(item.enemy.generals, false, {
                html: `<span class="ca-badge ca-badge-cnt">×${item.enemy.count}</span>`,
                cls: 'ca-gen-extra'
              })}
            </div>
            <div class="ca-rec-arrow"></div>
            <div class="ca-rec-counters">${countersHtml}</div>
          </div>`;
        }).join('')
      }`;
  };

  window.caShowRecSrcNT = function (gi, ci) {
    const d = (window._caRecNTData || [])[gi];
    if (d && d.counters[ci]) showImageSource(d.counters[ci].records);
  };

  // ==================== 渲染：矩阵 敌方克制分析矩阵 ====================

  window.renderCounterMatrix = async function () {
    const el = document.getElementById('caPanelMatrix');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:#666;font-size:12px;text-align:center;">计算中...</div>';
    await ensureRecords();
    const recs = records();
    const { top10, top10Keys, ourTeams, matrix } = analyzeCounterMatrix(recs);

    if (!top10.length) {
      el.innerHTML = '<div class="ca-empty-blk">暂无足够数据<br><small>需要战报数据才能生成矩阵</small></div>';
      return;
    }

    window._caMxData = { ourTeams, top10Keys, matrix };

    const headerCols = top10.map((e, i) => `<th class="ca-mx-col-head">
        <div class="ca-mx-rank">Top${i + 1}</div>
        ${e.generals.map(g => `<div class="ca-mx-gen" style="color:${heroColor(g)}">${escHtml(g)}</div>`).join('')}
      </th>`).join('');

    const countCols = top10.map(e => `<th class="ca-mx-count-cell">${e.count}场</th>`).join('');

    // 汇总：每个 top10 敌方 → 绝对克制（≥75%且≥10场）/ 相对优势（50-75%且≥10场）
    const summaryData = top10Keys.map(ek => {
      const absolute = [], relative = [];
      for (const ot of ourTeams) {
        if (ot.key === ek) continue;
        const cell = matrix[ot.key] && matrix[ot.key][ek];
        if (!cell || cell.total < 10) continue;
        const wr = Math.round(cell.wins / cell.total * 1000) / 10;
        const label = ot.generals.map(g => escHtml(g)).join('·');
        if (wr >= 75)       absolute.push({ label, wr });
        else if (wr >= 50)  relative.push({ label, wr });
      }
      absolute.sort((a, b) => b.wr - a.wr);
      relative.sort((a, b) => b.wr - a.wr);
      return { absolute, relative };
    });

    const mkSumCell = (arr, cls) => {
      if (!arr.length) return `<td class="ca-mx-sum-data ca-mx-empty-cell">—</td>`;
      return `<td class="ca-mx-sum-data">${arr.map(t => `<div class="ca-mx-sum-item">${t.label}<br><span class="${cls}">${t.wr}%</span></div>`).join('')}</td>`;
    };
    const absCells = summaryData.map(s => mkSumCell(s.absolute, 'ca-mx-sum-abs')).join('');
    const relCells = summaryData.map(s => mkSumCell(s.relative, 'ca-mx-sum-rel')).join('');

    const summaryRows = `
      <tr class="ca-mx-sum-row">
        <td class="ca-mx-sum-label" rowspan="2">克制队伍<br>分析总结</td>
        <td class="ca-mx-sum-type ca-mx-sum-type-abs">绝对克制队伍<div class="ca-mx-sum-note">胜率≥75%&nbsp;且≥10场</div></td>
        ${absCells}
      </tr>
      <tr class="ca-mx-sum-row">
        <td class="ca-mx-sum-type ca-mx-sum-type-rel">相对优势队伍<div class="ca-mx-sum-note">胜率50%~75%&nbsp;且≥10场</div></td>
        ${relCells}
      </tr>`;

    const bodyRows = ourTeams.map((ot, ri) => {
      const cells = top10Keys.map((ek, ci) => {
        if (ot.key === ek) return `<td class="ca-mx-empty-cell">—</td>`;
        const cell = matrix[ot.key] && matrix[ot.key][ek];
        if (!cell || cell.total === 0) return `<td class="ca-mx-empty-cell">—</td>`;
        const wr = Math.round(cell.wins / cell.total * 1000) / 10;
        const avgLoss = cell.enemyLoss ? Math.round(cell.counterLoss / cell.enemyLoss * 100) : 0;
        let bg, tc;
        if (wr > 50)      { bg = 'rgba(46,204,113,0.18)'; tc = '#2ecc71'; }
        else if (wr < 50) { bg = 'rgba(231,76,60,0.18)';  tc = '#e74c3c'; }
        else              { bg = 'rgba(150,150,150,0.13)'; tc = '#aaa'; }
        return `<td class="ca-mx-data-cell ca-mx-clickable" style="background:${bg};cursor:pointer;" onclick="caMxShowSrc(${ri},${ci})" title="点击查看溯源战报">
          <div class="ca-mx-wr" style="color:${tc};">${wr}%</div>
          <div class="ca-mx-sub">${cell.total}场</div>
          <div class="ca-mx-sub">战损${avgLoss}%</div>
        </td>`;
      }).join('');
      const gensHtml = ot.generals.map(g => `<div class="ca-mx-gen" style="color:${heroColor(g)}">${escHtml(g)}</div>`).join('');
      return `<tr class="ca-mx-row"><td class="ca-mx-left-cell" colspan="2">${gensHtml}</td>${cells}</tr>`;
    }).join('');

    el.innerHTML = `
      <div class="ca-hint-row">
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
          <p class="ca-hint" style="text-align:center;margin:0;">敌方高频武将组合 Top${top10.length}（列）× 所有参与对战的队伍（行）。绿色=胜率&gt;50%，红色=胜率&lt;50%，灰色=50%，空格=无交战记录。</p>
          <p style="margin:0;text-align:center;font-size:15px;font-weight:700;color:var(--accent,#5b4fff);letter-spacing:.02em;">基于 <span style="font-size:22px;font-weight:900;">${recs.length}</span> 封有效战报分析</p>
        </div>
        <button class="ca-hint-row-export" onclick="caExportTab('matrix')">⬇ 导出打印</button>
      </div>
      <div class="ca-mx-wrap">
        <table class="ca-mx-tbl">
          <thead>
            <tr>
              <th class="ca-mx-left-head" rowspan="3" colspan="2" style="font-weight:700;">对战队伍</th>
              <th colspan="${top10.length}" style="text-align:center;background:var(--bg2,#111122);color:var(--accent,#5b4fff);font-size:12px;font-weight:600;padding:6px 4px;border:1px solid var(--border,#2a2a3e);letter-spacing:.04em;">敌方高频队伍 Top${top10.length}</th>
            </tr>
            <tr class="ca-mx-head-row">
              ${headerCols}
            </tr>
            <tr class="ca-mx-count-row">${countCols}</tr>
          </thead>
          <tbody>${summaryRows}${bodyRows}</tbody>
        </table>
      </div>`;
  };

  window.caMxShowSrc = function (ri, ci) {
    const d = window._caMxData;
    if (!d) return;
    const ot = d.ourTeams[ri];
    const ek = d.top10Keys[ci];
    if (!ot || !ek) return;
    const cell = d.matrix[ot.key] && d.matrix[ot.key][ek];
    if (cell && cell.records && cell.records.length) showImageSource(cell.records);
  };

  // ==================== 渲染：玩家胜率排行榜 ====================

  window.renderPlayerLeaderboard = async function () {
    const el = document.getElementById('caPanelPlayerLeaderboard');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:#666;font-size:12px;text-align:center;">计算中...</div>';
    await ensureRecords();
    const recs = records();
    const data = analyzePlayerLeaderboard(recs);
    window._caPlayerData = data;

    if (!data.length) {
      el.innerHTML = '<div class="ca-empty-blk">暂无玩家数据<br><small>战报中需要填写玩家名称才能统计</small></div>';
      return;
    }

    const bodyHtml = data.map((player, pi) => {
      const teams = player.teamList;
      const rowspan = Math.max(teams.length, 1);
      const rankClass = pi < 3 ? ' ca-rank-top' : '';
      const top3Cls = pi < 3 ? ' ca-plb-top3' : '';
      const wrColor = player.avgWinRate >= 60 ? '#2ecc71' : player.avgWinRate < 40 ? '#e74c3c' : '#f39c12';

      if (!teams.length) {
        return `<tr class="ca-row ca-plb-first-row${top3Cls}">
          <td class="ca-idx ca-rank${rankClass}">${pi + 1}</td>
          <td class="ca-plb-name">${escHtml(player.name)}</td>
          <td class="ca-plb-stat" style="color:${wrColor}">${player.avgWinRate}%</td>
          <td class="ca-plb-stat">${player.totalBattles}场</td>
          <td class="ca-plb-team" colspan="4"><span class="ca-dim">—</span></td>
        </tr>`;
      }

      return teams.map((team, ti) => {
        const isFirst = ti === 0;
        const firstCols = isFirst ? `
          <td class="ca-idx ca-rank${rankClass} ca-plb-rsep" rowspan="${rowspan}">${pi + 1}</td>
          <td class="ca-plb-name ca-plb-rsep" rowspan="${rowspan}">${escHtml(player.name)}</td>
          <td class="ca-plb-stat ca-plb-rsep" rowspan="${rowspan}" style="color:${wrColor}">${player.avgWinRate}%</td>
          <td class="ca-plb-stat ca-plb-rsep" rowspan="${rowspan}">${player.totalBattles}场</td>
        ` : '';
        const wr = team.winRate;
        const wrCls = wr > 50 ? 'ca-green' : wr < 50 ? 'ca-best-red' : '';
        return `<tr class="ca-row ca-plb-team-row${isFirst ? ' ca-plb-first-row' + top3Cls : ''}">
          ${firstCols}
          <td class="ca-plb-team">${teamChip(team.generals, team.tactics, team.formation, null)}</td>
          <td class="ca-num-cell">${team.battles}场</td>
          <td class="ca-num-cell ${wrCls}">${wr}%</td>
          <td class="ca-center"><button class="ca-src-btn" onclick="caShowPlayerSrc(${pi},${ti})">溯源</button></td>
        </tr>`;
      }).join('');
    }).join('');

    el.innerHTML = `
      <div class="ca-hint-row">
        <p class="ca-hint">统计所有上场玩家（左右双方均计入）的胜率排行，先按平均胜率降序、再按总场次降序。每行展示该玩家使用的队伍，按队伍胜率降序排列。胜率 = 总胜分 / 总场次（平局各计0.5分）。</p>
      </div>
      <div class="ca-tbl-wrap">
        <table class="ca-tbl ca-plb-tbl">
          <thead><tr>
            <th class="ca-th-idx">#</th>
            <th class="ca-plb-th-name">玩家名称</th>
            <th class="ca-th-num">平均胜率</th>
            <th class="ca-th-num">总场次</th>
            <th class="ca-plb-th-team">队伍 / 战法</th>
            <th class="ca-th-num">队伍场次</th>
            <th class="ca-th-num">队伍胜率</th>
            <th class="ca-th-act">溯源</th>
          </tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`;
  };

  window.caShowPlayerSrc = async function (pi, ti) {
    const player = (window._caPlayerData || [])[pi];
    if (!player) return;
    const team = player.teamList[ti];
    if (!team) return;
    await showPlayerTeamSource(team.records, team.sides, player.name, team.generals);
  };

  async function showPlayerTeamSource(recs, sides, playerName, generals) {
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

    const gensStr = generals.map(g => g).join('·');
    const tableDiv = document.createElement('div');
    tableDiv.style.cssText = 'width:min(760px,92vw);background:#111122;border-radius:8px;padding:16px;border:1px solid #2a2a3e;';

    const rowsHtml = recs.map((r, i) => {
      const side = sides[i] || 'left';
      const oppSide = side === 'left' ? 'right' : 'left';
      const oppPlayer = ((oppSide === 'right' ? r.rightPlayer : r.leftPlayer) || '—').trim();
      const oppGens = normGens(getGenerals(r, oppSide));
      const w = winner(r.result);
      const wonLabel = w === side ? '胜' : w === 'draw' ? '平' : '负';
      const resultColor = wonLabel === '胜' ? '#2ecc71' : wonLabel === '负' ? '#e74c3c' : '#aaa';
      const date = (r.createdAt || r.created_at || '').substring(0, 10);
      const oppGensHtml = oppGens.length
        ? oppGens.map(g => `<b style="color:${heroColor(g)}">${escHtml(g)}</b>`).join('<span style="color:#333;margin:0 1px;">·</span>')
        : '<span style="color:#444;">—</span>';
      return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
        <td style="padding:5px 8px;text-align:center;color:#555;font-size:11px;">${i + 1}</td>
        <td style="padding:5px 8px;color:#777;font-size:11px;white-space:nowrap;">${escHtml(date)}</td>
        <td style="padding:5px 8px;color:#bbb;font-size:12px;white-space:nowrap;">${escHtml(oppPlayer)}</td>
        <td style="padding:5px 8px;font-size:12px;">${oppGensHtml}</td>
        <td style="padding:5px 8px;text-align:center;font-weight:700;font-size:13px;color:${resultColor};white-space:nowrap;">${wonLabel}</td>
      </tr>`;
    }).join('');

    tableDiv.innerHTML = `
      <div style="color:#9d8fff;font-size:13px;font-weight:600;margin-bottom:10px;">${escHtml(playerName)} · ${escHtml(gensStr)} — 共 ${recs.length} 场</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="color:#555;font-size:11px;border-bottom:1px solid #2a2a3e;">
          <th style="padding:4px 8px;text-align:center;">#</th>
          <th style="padding:4px 8px;text-align:left;">日期</th>
          <th style="padding:4px 8px;text-align:left;">对手玩家</th>
          <th style="padding:4px 8px;text-align:left;">对手队伍</th>
          <th style="padding:4px 8px;text-align:center;">结果</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    modal.appendChild(tableDiv);
    document.body.appendChild(modal);

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
    if (imgs.length) {
      const hdr = document.createElement('div');
      hdr.style.cssText = 'color:#888;font-size:11px;width:min(760px,92vw);text-align:left;margin-top:4px;';
      hdr.textContent = `图片溯源（共 ${imgs.length} 张）`;
      modal.appendChild(hdr);
      imgs.forEach((src, i) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div style="color:#666;font-size:11px;margin-bottom:4px;">第 ${i+1}/${imgs.length} 张</div>
          <img src="${escHtml(src)}" style="max-width:min(860px,90vw);border-radius:8px;border:1px solid #444;">`;
        modal.appendChild(wrap);
      });
    }
  }

  // ==================== 渲染：Tab 6 综合推荐队伍 ====================

  window.renderBestRecommendation = async function () {
    const el = document.getElementById('caPanelBestRec');
    if (!el) return;
    await ensureRecords();
    const data = analyzeBestRecommendation(records());
    window._caBestData = data;
    window._caBestSelectedIdx = 0;

    if (!data || !data.counters.length) {
      el.innerHTML = `<div class="ca-empty-blk">暂无数据<br><small>需要足够的战报才能生成综合推荐</small></div>`;
      return;
    }

    el.innerHTML = `
      <div class="ca-hint-row">
        <p class="ca-hint">基于敌方右侧高频武将组合（Top ${data.enemies.length}）和克制胜率，综合计算最有价值的出战队伍。得分 = Σ(高频权重 × 对战胜率)，满分100，无实战数据以50%胜率填充</p>
      </div>
      <div class="ca-best-layout">
        <div class="ca-best-left">
          <div class="ca-best-left-title">最有价值克制队伍排名</div>
          <div class="ca-tbl-wrap" style="border-radius:0 0 8px 8px;">
            <table class="ca-tbl" style="width:100%;">
              <thead><tr>
                <th class="ca-th-idx">#</th>
                <th style="text-align:left;">克制队伍（武将组合）</th>
                <th class="ca-th-num" style="width:18%;">得分</th>
              </tr></thead>
              <tbody id="caBestLeftBody"></tbody>
            </table>
          </div>
        </div>
        <div class="ca-best-right">
          <div id="caBestRightPanel"><div class="ca-empty-blk" style="padding:40px 0;">← 点击左侧队伍查看详情</div></div>
        </div>
      </div>`;

    renderBestLeftTable();
    renderBestRightPanel(0);
  };

  function renderBestLeftTable() {
    const data = window._caBestData;
    const selectedIdx = window._caBestSelectedIdx || 0;
    const el = document.getElementById('caBestLeftBody');
    if (!el || !data) return;
    el.innerHTML = data.counters.map((c, i) => `
      <tr class="ca-row ca-best-row${i === selectedIdx ? ' ca-best-selected' : ''}" onclick="selectBestCounter(${i})" title="点击查看详情">
        <td class="ca-idx ca-rank${i < 3 ? ' ca-rank-top' : ''}">${i + 1}</td>
        <td>${teamChipNoTacs(c.generals, false)}</td>
        <td class="ca-num-cell ca-best-score">${(c.score * 100).toFixed(2)}</td>
      </tr>`).join('');
  }

  function renderBestRightPanel(idx) {
    const data = window._caBestData;
    const el = document.getElementById('caBestRightPanel');
    if (!el || !data) return;
    const counter = data.counters[idx];
    if (!counter) return;

    const hasAnyDefault = counter.details.some(d => d.isDefault);

    el.innerHTML = `
      <div class="ca-best-right-header">
        <div class="ca-best-right-team">${teamChipNoTacs(counter.generals, false)}</div>
        <div class="ca-best-right-meta">
          总得分 <b class="ca-best-score-big">${(counter.score * 100).toFixed(2)}</b>
          &ensp;|&ensp; 覆盖 ${counter.details.filter(d => !d.isDefault).length} / ${counter.details.length} 支高频队伍
        </div>
      </div>
      <div class="ca-tbl-wrap" style="margin-top:0;border-top:none;border-radius:0 0 8px 8px;">
        <table class="ca-tbl ca-best-detail-tbl">
          <thead><tr>
            <th style="text-align:left;width:24%;">敌方高频队伍</th>
            <th class="ca-th-num" style="width:9%;">对战次数</th>
            <th class="ca-th-num" style="width:11%;">对战胜率</th>
            <th class="ca-th-num" style="width:11%;">战损率</th>
            <th class="ca-th-num" style="width:11%;">对战得分</th>
            <th class="ca-th-act" style="width:9%;">溯源</th>
          </tr></thead>
          <tbody>
            ${counter.details.map((d, di) => {
              const winRateStr = d.isDefault
                ? `<span class="ca-best-default">50%<sup>*</sup></span>`
                : `<span class="${d.winRate >= 0.5 ? 'ca-green' : 'ca-best-red'}">${(d.winRate * 100).toFixed(1)}%</span>`;
              const lossRateStr = d.lossRate !== null
                ? `${(d.lossRate * 100).toFixed(0)}%`
                : '<span class="ca-dim">—</span>';
              const hasSrc = d.records && d.records.length > 0;
              return `<tr class="ca-row">
                <td>${teamChipNoTacs(d.enemy, false, {
                  html: `<span class="ca-badge ca-badge-cnt">×${d.enemyCount}</span>`,
                  cls: 'ca-gen-extra'
                })}</td>
                <td class="ca-num-cell">${d.battles > 0 ? d.battles : '<span class="ca-dim">—</span>'}</td>
                <td class="ca-num-cell">${winRateStr}</td>
                <td class="ca-num-cell">${lossRateStr}</td>
                <td class="ca-num-cell ca-best-score">${(d.scoreContrib * 100).toFixed(3)}</td>
                <td class="ca-center">
                  ${hasSrc
                    ? `<button class="ca-src-btn" onclick="caBestShowSrc(${idx},${di})">溯源</button>`
                    : '<span class="ca-dim">—</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${hasAnyDefault ? '<p class="ca-hint" style="margin-top:6px;padding-left:4px;"><sup>*</sup> 无实战数据，采用默认50%胜率</p>' : ''}
    `;
  }

  window.selectBestCounter = function (idx) {
    window._caBestSelectedIdx = idx;
    renderBestLeftTable();
    renderBestRightPanel(idx);
  };

  window.caBestShowSrc = function (counterIdx, detailIdx) {
    const data = window._caBestData;
    if (!data) return;
    const counter = data.counters[counterIdx];
    if (!counter) return;
    const detail = counter.details[detailIdx];
    if (detail && detail.records && detail.records.length) showImageSource(detail.records);
    else alert('该战报组合暂无图片数据');
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
      enemyNoTacs:     { id: 'caPanelEnemyNoTacs',     title: '敌方高频队伍统计（无战法）' },
      recommendNoTacs: { id: 'caPanelRecommendNoTacs', title: '敌方高频胜率分析（无战法）' },
      matrix:          { id: 'caPanelMatrix',          title: '敌方克制分析矩阵表' },
    };
    const cfg = panelMap[tab];
    if (!cfg) return;
    const panel = document.getElementById(cfg.id);
    if (!panel) return;

    const clone = panel.cloneNode(true);
    clone.querySelectorAll('.ca-hint-row-export').forEach(el => el.remove());

    const projName = window.currentProjectName || '';
    const recCount = typeof records === 'function' ? records().length : '';
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const fullTitle = `${projName}[${recCount}]${cfg.title}${dateStr}`;

    const win = window.open('', '_blank', 'width=980,height=760');
    if (!win) { alert('请允许浏览器弹出窗口后重试'); return; }
    win.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${escHtml(fullTitle)}</title>
<style>${caGetPrintStyles()}</style>
</head>
<body>
<h2>${escHtml(fullTitle)}</h2>
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
        <!-- 时间范围过滤器 -->
        <div style="background:var(--bg2);padding:8px 12px;margin-bottom:8px;border-radius:6px;border:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:bold;color:var(--text);flex-shrink:0;">📅 时间：</span>
            <input type="date" id="caDateStart" onchange="caApplyDateFilter()" style="padding:4px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);max-width:140px;">
            <span style="color:var(--text3);font-size:11px;">至</span>
            <input type="date" id="caDateEnd" onchange="caApplyDateFilter()" style="padding:4px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);max-width:140px;">
            <button onclick="caSetDateRange(1)" style="padding:3px 10px;font-size:10px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);border-radius:3px;cursor:pointer;white-space:nowrap;">1天</button>
            <button onclick="caSetDateRange(3)" style="padding:3px 10px;font-size:10px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);border-radius:3px;cursor:pointer;white-space:nowrap;">3天</button>
            <button onclick="caSetDateRange(7)" style="padding:3px 10px;font-size:10px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);border-radius:3px;cursor:pointer;white-space:nowrap;">7天</button>
            <button onclick="caClearDateFilter()" style="padding:3px 10px;font-size:10px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);border-radius:3px;cursor:pointer;white-space:nowrap;">清除</button>
            <span id="caDateInfo" style="font-size:10px;color:var(--text3);margin-left:auto;white-space:nowrap;"></span>
          </div>
        </div>

        <div class="ca-tabs">
          <button class="ca-tab active" onclick="switchCounterTab('enemyNoTacs')" id="caTabEnemyNTBtn">敌方高频队伍统计（无战法）</button>
          <button class="ca-tab" onclick="switchCounterTab('recommendNoTacs')" id="caTabRecNTBtn">敌方高频胜率分析（无战法）</button>
          <button class="ca-tab" onclick="switchCounterTab('matrix')" id="caTabMatrixBtn">敌方克制分析矩阵表</button>
          <button class="ca-tab" onclick="switchCounterTab('playerLeaderboard')" id="caTabPlayerLBBtn">玩家胜率排行榜</button>
          <button class="ca-tab" onclick="switchCounterTab('relationship')" id="caTabRelBtn">克制关系</button>
          <button class="ca-tab" onclick="switchCounterTab('enemy')" id="caTabEnemyBtn">敌方高频（有战法）</button>
          <button class="ca-tab" onclick="switchCounterTab('recommend')" id="caTabRecBtn">克制推荐（有战法）</button>
        </div>

        <div id="caPanelEnemyNoTacs">
          <div class="ca-hint-row"><p class="ca-hint">敌方（右侧）队伍出场频率，仅以武将组合区分，不区分战法与阵型，全部显示。出场占比 = 出场次数 / 全部战报总数。</p><button class="ca-hint-row-export" onclick="caExportTab('enemyNoTacs')">⬇ 导出打印</button></div>
          <div class="ca-filter-row" style="align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            <span style="font-size:11px;color:#888;white-space:nowrap;flex-shrink:0;">平均红度：</span>
            ${caStarsCheckboxHtml('efnt')}
          </div>
          <div class="ca-tbl-wrap">
            <table class="ca-tbl">
              <thead><tr>
                <th class="ca-th-idx">#</th>
                <th>队伍（武将组合）</th>
                <th class="ca-th-num">出场次数</th>
                <th class="ca-th-num">出场占比</th>
              </tr></thead>
              <tbody id="enemyHighFreqBodyNoTacs"></tbody>
            </table>
          </div>
        </div>

        <div id="caPanelRecommendNoTacs" style="display:none;">
          <div class="ca-hint-row"><p class="ca-hint">针对高频武将组合，找出有战胜记录的克制武将组合（不区分战法与阵型），至少1胜，全部显示</p><button class="ca-hint-row-export" onclick="caExportTab('recommendNoTacs')">⬇ 导出打印</button></div>
          <div id="counterRecommendationsNoTacs"></div>
        </div>

        <div id="caPanelMatrix" style="display:none;"></div>

        <div id="caPanelPlayerLeaderboard" style="display:none;"></div>

        <div id="caPanelRelationship" style="display:none;">
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

      </div>`;

    // 初始化时间过滤信息显示
    setTimeout(() => {
      const info = document.getElementById('caDateInfo');
      if (info) {
        const total = (window.allRecords || []).length;
        info.textContent = `共 ${total} 条战报`;
      }
    }, 100);

    switchCounterTab('enemyNoTacs');
  };

  // ==================== 时间过滤功能 ====================
  window.caSetDateRange = function(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    const startInput = document.getElementById('caDateStart');
    const endInput = document.getElementById('caDateEnd');
    if (startInput) startInput.valueAsDate = start;
    if (endInput) endInput.valueAsDate = end;

    caApplyDateFilter();
  };

  window.caClearDateFilter = function() {
    const startInput = document.getElementById('caDateStart');
    const endInput = document.getElementById('caDateEnd');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';

    if (typeof window.clearWinrateDateFilter === 'function') {
      window.clearWinrateDateFilter();
    }
    caUpdateDateInfo();
    caRefreshCurrentTab();
  };

  window.caApplyDateFilter = function() {
    const startInput = document.getElementById('caDateStart');
    const endInput = document.getElementById('caDateEnd');

    // 同步到全局过滤器
    if (typeof window.applyWinrateDateFilter === 'function') {
      const wrStart = document.getElementById('wrDateStart');
      const wrEnd = document.getElementById('wrDateEnd');
      if (wrStart && startInput) wrStart.value = startInput.value;
      if (wrEnd && endInput) wrEnd.value = endInput.value;
      window.applyWinrateDateFilter();
    }

    caUpdateDateInfo();
    caRefreshCurrentTab();
  };

  function caUpdateDateInfo() {
    const info = document.getElementById('caDateInfo');
    if (!info) return;

    const filtered = records();
    const total = (window.allRecords || []).length;

    const startInput = document.getElementById('caDateStart');
    const endInput = document.getElementById('caDateEnd');

    if ((startInput && startInput.value) || (endInput && endInput.value)) {
      info.textContent = `已筛选：${filtered.length} / ${total} 条战报`;
      info.style.color = 'var(--accent)';
    } else {
      info.textContent = `共 ${total} 条战报`;
      info.style.color = 'var(--text3)';
    }
  }

  function caRefreshCurrentTab() {
    // 获取当前激活的tab
    const activeBtn = document.querySelector('.ca-tab.active');
    if (!activeBtn) return;

    const tab = activeBtn.id.replace('caTab', '').replace('Btn', '');
    const tabMap = {
      'EnemyNT': 'enemyNoTacs',
      'RecNT': 'recommendNoTacs',
      'Matrix': 'matrix',
      'PlayerLB': 'playerLeaderboard',
      'Rel': 'relationship',
      'Enemy': 'enemy',
      'Rec': 'recommend'
    };

    const fullTab = tabMap[tab] || 'enemyNoTacs';

    // 重新渲染当前tab
    if (fullTab === 'enemyNoTacs') renderEnemyHighFreqNoTacs();
    else if (fullTab === 'recommendNoTacs') renderCounterRecommendationsNoTacs();
    else if (fullTab === 'matrix') renderCounterMatrix();
    else if (fullTab === 'playerLeaderboard') renderPlayerLeaderboard();
    else if (fullTab === 'relationship') renderCounterAnalysis();
    else if (fullTab === 'enemy') renderEnemyHighFreq();
    else if (fullTab === 'recommend') renderCounterRecommendations();
  }

  window.switchCounterTab = async function (tab) {
    const panels = {
      enemyNoTacs:       'caPanelEnemyNoTacs',
      recommendNoTacs:   'caPanelRecommendNoTacs',
      matrix:            'caPanelMatrix',
      playerLeaderboard: 'caPanelPlayerLeaderboard',
      relationship:      'caPanelRelationship',
      enemy:             'caPanelEnemy',
      recommend:         'caPanelRecommend',
    };
    const btns = {
      enemyNoTacs:       'caTabEnemyNTBtn',
      recommendNoTacs:   'caTabRecNTBtn',
      matrix:            'caTabMatrixBtn',
      playerLeaderboard: 'caTabPlayerLBBtn',
      relationship:      'caTabRelBtn',
      enemy:             'caTabEnemyBtn',
      recommend:         'caTabRecBtn',
    };
    Object.keys(panels).forEach(t => {
      const p = document.getElementById(panels[t]);
      const b = document.getElementById(btns[t]);
      if (p) p.style.display = t === tab ? 'block' : 'none';
      if (b) b.classList.toggle('active', t === tab);
    });
    if (tab === 'enemyNoTacs')              await renderEnemyHighFreqNoTacs();
    else if (tab === 'recommendNoTacs')    await renderCounterRecommendationsNoTacs();
    else if (tab === 'matrix')             await renderCounterMatrix();
    else if (tab === 'playerLeaderboard')  await renderPlayerLeaderboard();
    else if (tab === 'relationship')       await renderCounterAnalysis();
    else if (tab === 'enemy')              await renderEnemyHighFreq();
    else if (tab === 'recommend')          await renderCounterRecommendations();
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

      /* ---- 平均红度筛选按钮 ---- */
      .ca-stars-btn{padding:1px 7px;border:1px solid #333;border-radius:3px;background:transparent;color:#777;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .15s;}
      .ca-stars-btn:hover{background:rgba(255,255,255,.06);color:#ccc;border-color:#555;}

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

      /* ---- 均红筛选副行 ---- */
      .ca-rec-sub-filter{display:flex;align-items:center;background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);border-top:none;padding:6px 14px;}
      .ca-rec-sub-filter-col{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0;}
      .ca-rec-sub-filter-col:first-child{flex:0 0 33.333%;}
      .ca-rec-sub-filter-col:last-child{flex:1 1 0;}

      /* ---- 矩阵表 ---- */
      .ca-mx-wrap{overflow-x:auto;}
      .ca-mx-tbl{width:auto;min-width:100%;border-collapse:collapse;font-size:12px;table-layout:auto;}
      .ca-mx-tbl th,.ca-mx-tbl td{border:1px solid var(--border,#2a2a3e);padding:4px 6px;vertical-align:middle;}
      .ca-mx-left-head{background:var(--bg2,#111122);color:#888;font-size:11px;text-align:center;font-weight:500;white-space:nowrap;min-width:120px;}
      .ca-mx-col-head{background:var(--bg2,#111122);text-align:center;vertical-align:top;padding:6px 4px;min-width:90px;}
      .ca-mx-rank{color:#555;font-size:10px;margin-bottom:3px;}
      .ca-mx-gen{font-size:11px;white-space:nowrap;font-weight:600;line-height:1.5;display:block;}
      .ca-mx-count-row th{background:var(--bg,#0a0a1a);}
      .ca-mx-count-cell{text-align:center;color:#666;font-size:11px;font-weight:normal;padding:3px 4px;min-width:90px;}
      .ca-mx-left-cell{background:var(--bg2,#111122);padding:6px 10px;text-align:center;min-width:120px;}
      .ca-mx-empty-cell{text-align:center;color:#2a2a3e;font-size:13px;min-width:90px;}
      .ca-mx-data-cell{text-align:center;padding:5px 4px;min-width:90px;}
      .ca-mx-row:hover .ca-mx-left-cell{background:rgba(255,255,255,.04);}
      .ca-mx-row:hover .ca-mx-data-cell{filter:brightness(1.2);}
      .ca-mx-wr{font-size:14px;font-weight:700;line-height:1.4;display:block;}
      .ca-mx-sub{font-size:10px;color:#777;margin-top:1px;white-space:nowrap;display:block;}

      /* ---- 矩阵汇总行 ---- */
      .ca-mx-sum-row{border-top:2px solid var(--accent,#5b4fff);}
      .ca-mx-sum-row:last-of-type{border-bottom:2px solid var(--accent,#5b4fff);}
      .ca-mx-sum-label{background:rgba(91,79,255,.12);color:var(--accent,#5b4fff);font-size:11px;font-weight:700;text-align:center;vertical-align:middle;padding:6px 4px;white-space:nowrap;line-height:1.6;}
      .ca-mx-sum-type{background:var(--bg2,#111122);font-size:10px;font-weight:600;vertical-align:middle;padding:5px 6px;white-space:nowrap;line-height:1.5;}
      .ca-mx-sum-type-abs{color:#2ecc71;}
      .ca-mx-sum-type-rel{color:#f39c12;}
      .ca-mx-sum-note{font-size:9px;font-weight:400;color:#555;margin-top:2px;}
      .ca-mx-sum-data{background:var(--bg,#0a0a1a);padding:5px 6px;vertical-align:top;text-align:center;min-width:90px;}
      .ca-mx-sum-item{font-size:10px;color:#bbb;line-height:1.6;white-space:normal;display:block;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);}
      .ca-mx-sum-item:last-child{border-bottom:none;}
      .ca-mx-sum-abs{color:#2ecc71;font-weight:700;margin-left:4px;display:inline;}
      .ca-mx-sum-rel{color:#f39c12;font-weight:700;margin-left:4px;display:inline;}

      /* ---- Tab6 综合推荐 ---- */
      .ca-best-layout{display:flex;gap:16px;align-items:flex-start;margin-top:4px;}
      .ca-best-left{flex:0 0 33%;min-width:0;}
      .ca-best-right{flex:1 1 0;min-width:0;}
      .ca-best-left-title{background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);
        border-radius:8px 8px 0 0;padding:8px 14px;font-size:12px;font-weight:600;
        color:var(--accent,#f0b429);letter-spacing:.04em;}
      .ca-best-row{cursor:pointer;transition:background .12s;}
      .ca-best-row:hover td{background:rgba(91,79,255,.08) !important;}
      .ca-best-selected td{background:rgba(91,79,255,.14) !important;border-left:3px solid var(--accent,#5b4fff);}
      .ca-best-score{color:var(--accent,#f0b429);font-weight:700;}
      .ca-best-default{color:#888;font-size:11px;}
      .ca-best-red{color:#e74c3c;font-weight:600;}
      .ca-best-right-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
        background:var(--bg2,#111122);border:1px solid var(--border,#2a2a3e);
        border-radius:8px 8px 0 0;padding:10px 14px;}
      .ca-best-right-team{flex:1 1 auto;min-width:0;}
      .ca-best-right-meta{flex:0 0 auto;font-size:11px;color:var(--text3,#888);white-space:nowrap;}
      .ca-best-score-big{color:var(--accent,#f0b429);font-size:14px;}
      .ca-best-detail-tbl{table-layout:fixed;}

      /* ---- 玩家胜率排行榜 ---- */
      .ca-plb-tbl{table-layout:auto;}
      .ca-plb-th-name{text-align:left;min-width:80px;white-space:nowrap;}
      .ca-plb-th-team{text-align:left;}
      .ca-plb-name{font-size:13px;color:#ddd;font-weight:600;white-space:nowrap;padding-right:12px;vertical-align:top;padding-top:14px;}
      .ca-plb-stat{text-align:center;font-size:14px;font-weight:700;white-space:nowrap;vertical-align:top;padding-top:14px;}
      .ca-plb-team{padding:6px 10px;}
      .ca-plb-first-row td{border-top:2px solid rgba(255,255,255,.08) !important;}
      .ca-plb-top3.ca-plb-first-row td{border-top-color:rgba(245,197,66,.18) !important;}
      .ca-plb-rsep{border-right:1px solid rgba(255,255,255,.05);}

      /* ==================== 移动端适配 ==================== */
      @media(max-width:768px){
        /* 根容器 */
        .ca-root{padding:8px 4px;}

        /* 子标签导航 → 横向滚动，禁止换行 */
        .ca-tabs{overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;
          scrollbar-width:none;padding-bottom:2px;}
        .ca-tabs::-webkit-scrollbar{display:none;}
        .ca-tab{flex-shrink:0;white-space:nowrap;padding:6px 10px;font-size:11px;}

        /* 矩阵表：提示横屏 */
        .ca-mx-wrap::before{content:"矩阵表较宽，建议横屏查看";display:block;
          text-align:center;color:#777;font-size:11px;padding:6px 0 4px;font-style:italic;}

        /* 克制推荐 Tab3/Tab6：敌方+克制方改竖排 */
        .ca-rec-header{flex-wrap:wrap;gap:4px;padding:8px 10px;}
        .ca-rec-header-left,.ca-rec-header-mid{flex:1 1 auto;text-align:left;}
        .ca-rec-header-right{flex:1 1 100%;justify-content:flex-start;}
        .ca-rec-arrow-spacer{display:none;}
        .ca-rec-group{flex-direction:column;}
        .ca-rec-enemy{flex:none;border-right:none;border-bottom:1px solid var(--border,#2a2a3e);}
        .ca-rec-arrow{display:none;}
        .ca-rec-counter{flex-direction:column;}
        .ca-rec-counter-team{border-right:none;border-bottom:1px solid rgba(255,255,255,.04);}
        .ca-rec-counter-stats{flex-wrap:wrap;gap:4px;padding:6px 10px;}
        .ca-stat-item{flex:0 0 auto;min-width:70px;font-size:12px;}

        /* Tab6 综合推荐：左右改上下 */
        .ca-best-layout{flex-direction:column;gap:10px;}
        .ca-best-left{flex:none;width:100%;}
        .ca-best-right-header{flex-wrap:wrap;}

        /* 导出按钮行：手机上折叠 */
        .ca-hint-row{flex-wrap:wrap;}
        .ca-hint-row-export{align-self:flex-start;}

        /* 通用表格：触控滚动 */
        .ca-tbl-wrap{-webkit-overflow-scrolling:touch;}

        /* 均红筛选副行：竖排两行 */
        .ca-rec-sub-filter{flex-wrap:wrap;padding:6px 10px;gap:6px;}
        .ca-rec-sub-filter-col:first-child{flex:1 1 100%;}
        .ca-rec-sub-filter-col:last-child{flex:1 1 100%;}
        .ca-rec-sub-filter-spacer{display:none;}

        /* 矩阵表：触控滚动 */
        .ca-mx-wrap{-webkit-overflow-scrolling:touch;}
      }
    `;
    document.head.appendChild(s);
  }

})();

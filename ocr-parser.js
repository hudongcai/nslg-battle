'use strict';
// OCR 解析模块（服务端）
// 功能：mapPaddleResult / setFlat — PaddleOCR 结构化结果 → DB 记录

// ─── 扁平化字段 ────────────────────────────────────────────────────────────
function setFlat(rec, side, generals, tactics) {
  const gp = side === 'left' ? 'leftGeneral' : 'rightGeneral';
  const tp = side === 'left' ? 'leftTactic'  : 'rightTactic';
  rec[gp+'1'] = generals[0] || ''; rec[gp+'2'] = generals[1] || ''; rec[gp+'3'] = generals[2] || '';
  rec[tp+'1_1'] = tactics[0] || ''; rec[tp+'1_2'] = tactics[1] || ''; rec[tp+'1_3'] = tactics[2] || '';
  rec[tp+'2_1'] = tactics[3] || ''; rec[tp+'2_2'] = tactics[4] || ''; rec[tp+'2_3'] = tactics[5] || '';
  rec[tp+'3_1'] = tactics[6] || ''; rec[tp+'3_2'] = tactics[7] || ''; rec[tp+'3_3'] = tactics[8] || '';
}

// ─── PaddleOCR 结构化结果映射 ──────────────────────────────────────────────
function mapPaddleResult(data) {
  const winnerMap = { left:'胜', right:'败', draw:'平', unknown:'' };
  const rec = {
    time: new Date().toLocaleString('zh-CN'),
    result:        winnerMap[data.winner] ?? '',
    leftPlayer:    data.leftPlayer    || '',
    leftAlliance:  data.leftAlliance  || '',
    leftFormation: data.leftFormation || '',
    leftLoss:      data.leftDamage    ?? 0,
    leftTotal:     data.leftTroops    ?? 0,
    rightPlayer:    data.rightPlayer    || '',
    rightAlliance:  data.rightAlliance  || '',
    rightFormation: data.rightFormation || '',
    rightLoss:      data.rightDamage    ?? 0,
    rightTotal:     data.rightTroops    ?? 0,
    battleDate:     data.battleDate     || '',
    leftGenerals:  data.leftGenerals  || [],
    leftTactics:   data.leftTactics   || [],
    rightGenerals: data.rightGenerals || [],
    rightTactics:  data.rightTactics  || [],
  };
  if (rec.leftLoss  && rec.leftTotal>0)  rec.leftLossRate  = Math.min(999.99, Math.round((rec.leftLoss/rec.leftTotal)*10000)/100);
  if (rec.rightLoss && rec.rightTotal>0) rec.rightLossRate = Math.min(999.99, Math.round((rec.rightLoss/rec.rightTotal)*10000)/100);
  // 扁平化为 24 个独立字段
  setFlat(rec,'left',  rec.leftGenerals,  rec.leftTactics);
  setFlat(rec,'right', rec.rightGenerals, rec.rightTactics);
  delete rec.leftGenerals; delete rec.rightGenerals;
  delete rec.leftTactics;  delete rec.rightTactics;
  // 星级（红度）
  const ls = data.leftStars  || [0, 0, 0];
  const rs = data.rightStars || [0, 0, 0];
  rec.leftGeneral1Stars  = ls[0] ?? 0;
  rec.leftGeneral2Stars  = ls[1] ?? 0;
  rec.leftGeneral3Stars  = ls[2] ?? 0;
  rec.rightGeneral1Stars = rs[0] ?? 0;
  rec.rightGeneral2Stars = rs[1] ?? 0;
  rec.rightGeneral3Stars = rs[2] ?? 0;
  return rec;
}

module.exports = { mapPaddleResult };

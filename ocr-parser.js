'use strict';
// OCR 解析模块（服务端）
// 功能：parseOCRResponse / mapPaddleResult / correctByDatabase / setFlat + 武将战法数据库

const gameData = require('./game-data.json');
const HERO_NAMES      = gameData.heroNames  || [];
const HERO_SKILLS     = gameData.heroSkills || [];       // 与 HERO_NAMES 同索引
const ALL_TACTIC_NAMES = gameData.allTactics || [];

// hero name → self skill
const HERO_SKILL_MAP = {};
HERO_NAMES.forEach((n, i) => { if (HERO_SKILLS[i]) HERO_SKILL_MAP[n] = HERO_SKILLS[i]; });
const VALID_TACTIC_SET = new Set(ALL_TACTIC_NAMES);

// ─── 字符串工具 ────────────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((_, j) => i || j));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function bestMatch(name, list) {
  if (!name || name === '未知' || name.length < 2) return name;
  let best = null, bestDist = Infinity;
  for (const item of list) {
    const d = levenshtein(name, item);
    if (d === 0) return item;
    if (d < bestDist) { bestDist = d; best = item; }
  }
  const threshold = name.length > 4 ? 2 : 1;
  return (best && bestDist <= threshold) ? best : name;
}

function bestMatchHeroName(name) {
  if (!name || name === '未知' || name.length < 2) return name;
  const cleaned = name.replace(/^\d+[级层兵\s]*/u, '').trim();
  if (cleaned !== name && cleaned.length >= 1) {
    if (cleaned.length === 1) {
      const matches = HERO_NAMES.filter(n => n.endsWith(cleaned));
      if (matches.length === 1) return matches[0];
      return name;
    }
    const r = bestMatch(cleaned, HERO_NAMES);
    if (r !== cleaned) return r;
  }
  return bestMatch(name, HERO_NAMES);
}

// ─── 扁平化字段 ────────────────────────────────────────────────────────────
function setFlat(rec, side, generals, tactics) {
  const gp = side === 'left' ? 'leftGeneral' : 'rightGeneral';
  const tp = side === 'left' ? 'leftTactic'  : 'rightTactic';
  rec[gp+'1'] = generals[0] || ''; rec[gp+'2'] = generals[1] || ''; rec[gp+'3'] = generals[2] || '';
  rec[tp+'1_1'] = tactics[0] || ''; rec[tp+'1_2'] = tactics[1] || ''; rec[tp+'1_3'] = tactics[2] || '';
  rec[tp+'2_1'] = tactics[3] || ''; rec[tp+'2_2'] = tactics[4] || ''; rec[tp+'2_3'] = tactics[5] || '';
  rec[tp+'3_1'] = tactics[6] || ''; rec[tp+'3_2'] = tactics[7] || ''; rec[tp+'3_3'] = tactics[8] || '';
}

// ─── 数据库纠错 ────────────────────────────────────────────────────────────
function correctByDatabase(record) {
  ['left', 'right'].forEach(side => {
    record[side+'Generals'] = (record[side+'Generals'] || []).map(bestMatchHeroName);
    record[side+'Tactics']  = (record[side+'Tactics']  || []).map(n => {
      if (!n || n === '未知') return '未知';
      const matched = bestMatch(n, ALL_TACTIC_NAMES);
      if (VALID_TACTIC_SET.has(matched)) return matched;
      // 未入库但包含有效汉字：保留（新战法/数据库不完整时不丢弃）
      const hanCount = (n.match(/[一-鿿·•]/g) || []).length;
      if (hanCount >= 2) return n;
      return '未知';
    });
  });
}

// 自带战法补全：若武将已知且战法不足 3 个，尝试补入自带战法
function autoFillHeroSkill(generalName, heroTacs) {
  const corrected = bestMatchHeroName(generalName);
  const selfSkill = HERO_SKILL_MAP[corrected];
  if (!selfSkill) return heroTacs;
  const alreadyIn = heroTacs.some(t => t === selfSkill || levenshtein(t, selfSkill) <= 1);
  if (!alreadyIn) return [selfSkill, ...heroTacs];
  return heroTacs;
}

// ─── LLM 文本解析 ──────────────────────────────────────────────────────────
function parseOCRResponse(text) {
  const record = {
    time: new Date().toLocaleString('zh-CN'),
    result: '',
    leftPlayer: '', leftAlliance: '', leftGenerals: [], leftTactics: [],
    leftFormation: '', leftLoss: null, leftTotal: null,
    leftStars: [0, 0, 0],
    rightPlayer: '', rightAlliance: '', rightGenerals: [], rightTactics: [],
    rightFormation: '', rightLoss: null, rightTotal: null,
    rightStars: [0, 0, 0],
  };
  const rawText = text;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let side = '';
  let generalMap = {}, tacticsMap = {}, starsMap = {}, battleDate = '';

  function flush(sideKey) {
    const indices = Object.keys(generalMap).map(Number).sort((a, b) => a - b);
    if (indices.length > 0) {
      const gens = [], tacs = [], stars = [];
      indices.forEach(i => {
        const g = generalMap[i];
        if (g) gens.push(g);
        let heroTacs = tacticsMap[i] || [];
        if (g && g !== '未知' && heroTacs.length < 3) heroTacs = autoFillHeroSkill(g, heroTacs);
        tacs.push(...heroTacs);
        stars.push(starsMap[i] != null ? starsMap[i] : 0);
      });
      if (sideKey === 'left')  { record.leftGenerals  = gens; record.leftTactics  = tacs; record.leftStars = stars; }
      else if (sideKey === 'right') { record.rightGenerals = gens; record.rightTactics = tacs; record.rightStars = stars; }
    }
    generalMap = {}; tacticsMap = {}; starsMap = {};
  }

  for (const line of lines) {
    const isLeft   = line.includes('【左侧】') || /^[*#\s]*左侧[*#\s：:]*$/.test(line);
    const isRight  = line.includes('【右侧】') || /^[*#\s]*右侧[*#\s：:]*$/.test(line);
    const isResult = line.includes('【结果】') || line.includes('【胜负】') || /^[*#\s]*(结果|胜负)[*#\s：:]*$/.test(line);
    if (isLeft)   { if (side==='left') flush('left'); else if (side==='right') flush('right'); side='left';   continue; }
    if (isRight)  { if (side==='left') flush('left'); side='right';  continue; }
    if (isResult) { if (side==='left') flush('left'); else if (side==='right') flush('right'); side='result'; continue; }

    let ci = line.indexOf('：'); if (ci === -1) ci = line.indexOf(':'); if (ci === -1) continue;
    const key = line.substring(0, ci).trim();
    const val = line.substring(ci + 1).trim();

    const sm = key.match(/星级\s*(\d+)/);
    if (sm) { starsMap[parseInt(sm[1])] = parseInt(val) || 0; continue; }
    const gm = key.match(/武将\s*(\d+)/);
    if (gm) { generalMap[parseInt(gm[1])] = val; continue; }
    const tm = key.match(/战法\s*(\d+)/);
    if (tm && !key.includes('战损')) {
      tacticsMap[parseInt(tm[1])] = val.split(/[,，、]+/).map(t => t.trim())
        .filter(t => t && t !== '未知' && t !== '影本')
        .map(t => t.replace(/^影本[·.•]/, ''));
      continue;
    }
    if (key === '武将') {
      const names = val.split(/[,，、\s]+/).filter(n => n && n !== '未知');
      if (side==='left') record.leftGenerals=names; else if (side==='right') record.rightGenerals=names;
      continue;
    }
    if (key === '战法') {
      const tacts = val.split(/[,，、]+/).map(t=>t.trim()).filter(t=>t&&t!=='未知'&&t!=='影本').map(t=>t.replace(/^影本[·.•]/,''));
      if (side==='left') record.leftTactics=tacts; else if (side==='right') record.rightTactics=tacts;
      continue;
    }
    if (key.includes('玩家')) {
      if (side==='left') record.leftPlayer=val.trim(); else if (side==='right') record.rightPlayer=val.trim();
    } else if (key.includes('同盟')) {
      let v=val.trim(); if(v==='无'||v==='未知') v='';
      if (side==='left') record.leftAlliance=v; else if (side==='right') record.rightAlliance=v;
    } else if (key.includes('阵型')) {
      if (side==='left') record.leftFormation=val; else if (side==='right') record.rightFormation=val;
    } else if (key.includes('战损兵力')||key==='战损') {
      const wM=val.match(/([\d.]+)\s*万/);
      const v = wM ? parseFloat(wM[1])*10000 : +(val.match(/([\d.]+)/)||[])[1];
      if (v!=null && !isNaN(v)) { if(side==='left') record.leftLoss=v; else if(side==='right') record.rightLoss=v; }
    } else if (key.includes('总兵力')||key==='总兵') {
      const wM=val.match(/([\d.]+)\s*万/);
      const v = wM ? parseFloat(wM[1])*10000 : +(val.match(/([\d.]+)/)||[])[1];
      if (v!=null && !isNaN(v)) { if(side==='left') record.leftTotal=v; else if(side==='right') record.rightTotal=v; }
    } else if ((key.includes('胜负')||key.includes('结果')) && side==='result') {
      if (val.includes('胜')) record.result='胜'; else if (val.includes('败')) record.result='败'; else record.result='平';
    } else if (key.includes('日期')||key.includes('时间')||key.includes('战斗日期')) {
      const dm=val.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
      if (dm) battleDate=`${dm[1]}-${dm[2].padStart(2,'0')}-${dm[3].padStart(2,'0')}`;
    }
  }

  if (side==='left') flush('left'); else if (side==='right') flush('right');

  if (record.leftLoss!=null && record.leftTotal>0)  record.leftLossRate=(record.leftLoss/record.leftTotal)*100;
  if (record.rightLoss!=null && record.rightTotal>0) record.rightLossRate=(record.rightLoss/record.rightTotal)*100;

  // 玩家名/同盟名竖线拆分修复（与前端保持一致）
  const pipeRe=/[|｜丨]/;
  const namePattern=/([一-龥a-zA-Z0-9·•\-|]{2,15})/g;
  const excludeWords=['左侧','右侧','结果','胜负','胜','败','平','未知','雁形阵','箕形阵','鱼鳞阵','方圆阵','长蛇阵','锋矢阵','虎翼阵','阵型','战法','武将','兵力','总兵','战损','同盟','玩家','玩家名','战斗日期'];
  const candidates=[...new Set([...rawText.matchAll(namePattern)].map(m=>m[1]))].filter(n=>{
    if(n.length<2||n.length>15) return false;
    if(excludeWords.some(w=>n.includes(w))) return false;
    if(/^\d+$/.test(n)) return false;
    return true;
  });
  const fullNames=candidates.filter(n=>pipeRe.test(n));
  const plainNames=candidates.filter(n=>!pipeRe.test(n));
  ['left','right'].forEach(s=>{
    const ply=record[s+'Player'], ally=record[s+'Alliance'];
    if(ply&&ally&&pipeRe.test(ply)){ const pre=ply.split(pipeRe)[0].trim(); if(pre===ally) record[s+'Alliance']=''; }
    if(ally&&(!ply||!pipeRe.test(ply))){
      const mf=fullNames.find(fn=>{ const p=fn.split(pipeRe); return p.length>=2&&p[0].trim()===ally; });
      if(mf){ record[s+'Player']=mf; record[s+'Alliance']=''; }
    }
  });
  if(!record.leftPlayer||!record.rightPlayer){
    const used=new Set([record.leftPlayer,record.rightPlayer].filter(Boolean));
    const pool=[...fullNames,...plainNames].filter(n=>!used.has(n));
    if(!record.leftPlayer&&pool.length>0){ record.leftPlayer=pool[0]; used.add(pool[0]); }
    if(!record.rightPlayer){ const r=pool.filter(n=>!used.has(n)); if(r.length>0) record.rightPlayer=r[0]; }
  }

  record.battleDate = battleDate || '';
  // 星级（红度）扁平化
  const ls = record.leftStars  || [0, 0, 0];
  const rs = record.rightStars || [0, 0, 0];
  record.leftGeneral1Stars  = ls[0] ?? 0;
  record.leftGeneral2Stars  = ls[1] ?? 0;
  record.leftGeneral3Stars  = ls[2] ?? 0;
  record.rightGeneral1Stars = rs[0] ?? 0;
  record.rightGeneral2Stars = rs[1] ?? 0;
  record.rightGeneral3Stars = rs[2] ?? 0;
  delete record.leftStars; delete record.rightStars;
  correctByDatabase(record);
  setFlat(record,'left',  record.leftGenerals||[],  record.leftTactics||[]);
  setFlat(record,'right', record.rightGenerals||[], record.rightTactics||[]);
  delete record.leftGenerals; delete record.rightGenerals;
  delete record.leftTactics;  delete record.rightTactics;
  return record;
}

// ─── PaddleOCR 结构化结果映射 ──────────────────────────────────────────────
function mapPaddleResult(data) {
  const winnerMap = { left:'胜', right:'败', unknown:'' };
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
  if (rec.leftLoss  && rec.leftTotal>0)  rec.leftLossRate  = (rec.leftLoss/rec.leftTotal)*100;
  if (rec.rightLoss && rec.rightTotal>0) rec.rightLossRate = (rec.rightLoss/rec.rightTotal)*100;
  correctByDatabase(rec);
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

// ─── OCR Prompt（从前端迁移）──────────────────────────────────────────────
const OCR_PROMPT = `你是三国谋定天下游戏战报识别专家。请仔细分析这张战报截图，严格按照格式输出所有字段。

【画面布局说明】
- 画面分左右两半，中央有"胜"或"败"大字结果
- 每侧顶部有两个**物理位置相距较远**的独立区域（不在同一行）：
  ① 玩家名称区：位于页面上方，字体较大，单独显示玩家自己的名字
  ② 同盟名称区：位于玩家区下方（中间有空白），字体较小/颜色不同，**只显示同盟名，没有玩家名**
  ③ 阵型标签：显示阵型名称（如"方圆阵"、"雁行阵"、"鱼鳞阵"、"锋矢阵"、"箕形阵"等）
  **极其重要**：玩家名中若出现"丨"（如"风云丨天下"），这只是玩家的取名风格，"丨"左侧的文字是玩家名的一部分，**严禁**把"丨"左侧的文字当作同盟名填入同盟字段。同盟字段**只能**从画面上玩家名下方的同盟名称区域读取
- 每侧中部：三位武将的头像卡片横向排列，头像下方有武将名字，头像上方/角上通常有红色星标（★或红心）表示武将进阶次数（红度/星级）
- 每侧底部：三列战法框，每列对应上方的武将，每个框内列出该武将的战法名称（战法名旁边可能有"×数字"表示叠加层数，忽略这些数字，只取战法名称）
- 每侧顶部数字区：显示"战损:XXXX"（已损失兵力）和总兵力数字（通常格式为"XXXX/XXXXX"，斜线前为战损、斜线后为总兵）

【识别规则】
1. 同盟名：**只能**从画面中玩家名**下方**的同盟名称区域读取（字体较小，与玩家名区域不在同一行）。如果找不到独立的同盟名称区域，填"未知"。**严禁**从玩家名中提取或按"丨"拆分玩家名来获取同盟名
2. 玩家名：从玩家名称区域单独读取，完整保留，即使含有"丨"也不要拆分（"丨"是玩家名的一部分）
3. 阵型：读取顶部阵型标签文字（如方圆阵、雁行阵等）
4. 战损/总兵：找"战损"数值和总兵力数值，均为纯整数
5. 武将名：读取三个头像下方的名字，从左到右为武将1、2、3。必须输出武将1、武将2、武将3三行；若某位名字确实无法辨认，填"未知"。**武将名只能是纯汉字（通常2-4个字），严禁包含任何数字**；头像旁显示的数字（等级、兵力层数等）是装饰信息，绝对不属于武将名
6. 战法：每位武将**恰好有3个战法**（第1个为武将自带战法，第2、3个为装备战法）。武将1/2/3各自的战法须独立输出（战法1、战法2、战法3三行）；请逐格仔细读取，确保每位武将输出**恰好3个**战法名，用英文逗号分隔。**识别策略：战法文字即使模糊，也必须尽力辨认并输出最接近的汉字；只有当该格完全没有任何可见文字（空白格）时，才填"未知"**——绝对不允许因为"不确定"就放弃输出可见的战法名。注意："影本·XXXX"是一个完整战法名，必须用点号连接输出为"影本·XXXX"，**严禁**用逗号分隔写成"影本,XXXX"（这会导致误判！）。忽略"×数字"叠层标记。**严禁**将武将羁绊效果名（如"缘分"、"羁绊"、"义结金兰"等武将关系标签）输出为战法名，这些标签出现在武将头像卡内部，不是战法框的内容。**重要：同一武将在不同战报中的战法可能完全不同**——你必须逐格读取本张截图中实际显示的战法名称，绝对不得根据武将"通常使用"的战法进行替换或猜测
7. 结果："胜"或"败"或"平"，从画面中央大字判断（左侧视角：中央显示"胜"则左侧=胜）
8. 红度（星级）：每位武将头像上方/角上的红色星标（★或红心）数量，代表武将进阶次数。逐个武将读取星标数量，输出为整数（0-5）。必须输出星级1、星级2、星级3三行，分别对应武将1、2、3。无法识别时填0
9. 无法识别的文字填"未知"，数字填0

【输出格式（严格按此格式，不要增减字段）】
【左侧】
同盟：xxx
玩家：xxx
阵型：xxx
战损：数字
总兵：数字
武将1：武将名
战法1：战法A,战法B,战法C
星级1：数字
武将2：武将名
战法2：战法D,战法E,战法F
星级2：数字
武将3：武将名
战法3：战法G,战法H,战法I
星级3：数字
【右侧】
同盟：xxx
玩家：xxx
阵型：xxx
战损：数字
总兵：数字
武将1：武将名
战法1：战法A,战法B,战法C
星级1：数字
武将2：武将名
战法2：战法D,战法E,战法F
星级2：数字
武将3：武将名
战法3：战法G,战法H,战法I
星级3：数字
【结果】
胜负：胜或败或平
【日期】
战斗日期：YYYY-MM-DD（无法识别则留空）

【正确与错误对照（极其重要）】
假设玩家名区域显示：风云丨天下，同盟名区域显示：傲世天下
✅ 正确输出：玩家：风云丨天下  同盟：傲世天下
❌ 严禁输出：玩家：天下  同盟：风云  （这是拆分玩家名的错误行为！）
核心原则：玩家名区域里写的什么就完整复制什么，同盟名去同盟区域找，两者绝对不能混用！

【武将/战法行格式铁律】
武将名只能写在武将N行，绝对禁止出现在战法N行！三位武将的标签一个都不能省略：
❌ 错误输出（战法行混入武将名，或省略武将行）：
武将1：陆逊
战法1：A,B,C
战法2：孙权         ← 严禁！战法行出现武将名
战法2：D,E,F
战法3：小乔         ← 严禁！武将名出现在战法行
战法3：G,H,I
✅ 正确输出（严格交替，武将N在前，战法N在中，星级N在后）：
武将1：陆逊
战法1：A,B,C
星级1：4
武将2：孙权
战法2：D,E,F
星级2：2
武将3：小乔
战法3：G,H,I
星级3：1`;

module.exports = { parseOCRResponse, mapPaddleResult, setFlat, correctByDatabase, OCR_PROMPT };

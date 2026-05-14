/**
 * 战法数据库 - 三国谋定天下
 * 包含全部战法的属性、类型、效果、适用武将信息
 * 用于克制分析和战法库展示
 */
var ALL_TACTICS = [
  // ===== 主动战法（指挥/主动） =====
  { id: 't001', name: '八阵图', type: '主动', rarity: 'SSR', effect: 'control', desc: '布置八卦阵，使敌方全体陷入混乱状态2回合', applicableFactions: ['蜀'], heroMatch: ['诸葛亮'], cooldown: 3 },
  { id: 't002', name: '火烧连营', type: '主动', rarity: 'SSR', effect: 'dot', desc: '对敌方全体造成持续火焰伤害，每回合损失最大生命值15%', applicableFactions: ['吴'], heroMatch: ['陆逊','周瑜'], cooldown: 3 },
  { id: 't003', name: '火烧赤壁', type: '主动', rarity: 'SSR', effect: 'aoe', desc: '召唤东风，对敌方全体造成180%智力属性的法术伤害', applicableFactions: ['吴'], heroMatch: ['周瑜'], cooldown: 4 },
  { id: 't004', name: '天下无双', type: '主动', rarity: 'SSR', effect: 'single', desc: '对敌方单体造成300%武力属性的物理伤害，若击杀则可再次释放', applicableFactions: ['群'], heroMatch: ['吕布'], cooldown: 3 },
  { id: 't005', name: '奸雄', type: '被动', rarity: 'SSR', effect: 'buff', desc: '每次攻击回复自身5%最大生命值，且提升全队8%攻击力', applicableFactions: ['魏'], heroMatch: ['曹操'], cooldown: 0 },
  { id: 't006', name: '狼顾之相', type: '被动', rarity: 'SSR', effect: 'grow', desc: '战斗每经过1回合，智力属性提升10%，最多叠加10层', applicableFactions: ['魏'], heroMatch: ['司马懿'], cooldown: 0 },
  { id: 't007', name: '仁德之君', type: '主动', rarity: 'SSR', effect: 'heal', desc: '为我方全体回复20%已损失生命值，并附加护盾(吸收量=攻击力*150%)', applicableFactions: ['蜀'], heroMatch: ['刘备'], cooldown: 4 },
  { id: 't008', name: '武圣', type: '被动', rarity: 'SSR', effect: 'pierce', desc: '攻击有40%概率无视目标50%防御力，对低血量目标伤害额外提升50%', applicableFactions: ['蜀'], heroMatch: ['关羽'], cooldown: 0 },
  { id: 't009', name: '大都督', type: '指挥', rarity: 'SSR', effect: 'buff', desc: '战斗开始时，提升我方全体法术伤害25%，持续全场', applicableFactions: ['吴'], heroMatch: ['周瑜'], cooldown: 0 },
  { id: 't010', name: '制衡', type: '指挥', rarity: 'SSR', effect: 'flex', desc: '根据战场态势自动调整：我方人数少时提升攻防，多时提升速度', applicableFactions: ['吴'], heroMatch: ['孙权'], cooldown: 0 },

  // ===== 被动/反应战法 =====
  { id: 't011', name: '拔矢啖睛', type: '反制', rarity: 'SSR', effect: 'reflect', desc: '受到单次超过最大生命值20%的伤害时，将30%的伤害反弹给攻击者', applicableFactions: ['魏'], heroMatch: ['夏侯惇'], cooldown: 2 },
  { id: 't012', name: '万人敌', type: '主动', rarity: 'SSR', effect: 'control', desc: '发出怒吼，使敌方前排陷入恐惧状态1.5回合（无法行动）', applicableFactions: ['蜀'], heroMatch: ['张飞'], cooldown: 3 },
  { id: 't013', name: '七进七出', type: '主动', rarity: 'SSR', effect: 'multi', desc: '对敌方随机单体连续发动7次攻击，每次造成80%武力伤害', applicableFactions: ['蜀'], heroMatch: ['赵云'], cooldown: 4 },
  { id: 't014', name: '白衣渡江', type: '突进', rarity: 'SSR', effect: 'assassin', desc: '直接切入敌后排，对智力最高的敌人造成250%伤害并使其沉默2回合', applicableFactions: ['吴'], heroMatch: ['吕蒙'], cooldown: 3 },
  { id: 't015', name: '裸衣斗神', type: '被动', rarity: 'SSR', effect: 'tank', desc: '自身防御力提升50%，但攻击力降低20%；受到暴击时反弹100%暴击伤害', applicableFactions: ['魏'], heroMatch: ['许褚'], cooldown: 0 },
  { id: 't016', name: '不死之身', type: '被动', rarity: 'SSR', effect: 'survive', desc: '当生命值首次降至0时，保留1点血量并获得无敌效果1回合（每场战斗限一次）', applicableFactions: ['吴'], heroMatch: ['周泰'], cooldown: 0 },
  { id: 't017', name: '百步穿杨', type: '主动', rarity: 'SSR', effect: 'snipe', desc: '锁定敌方当前血量最低的目标，造成500%敏捷属性伤害（必定暴击）', applicableFactions: ['蜀'], heroMatch: ['黄忠'], cooldown: 4 },
  { id: 't018', name: '神行百里', type: '被动', rarity: 'SSR', effect: 'speed', desc: '自身速度属性永久提升30%，且每次攻击后速度额外提升5%（可叠加）', applicableFactions: ['魏'], heroMatch: ['夏侯渊'], cooldown: 0 },
  { id: 't019', name: '威震逍遥津', type: '突进', rarity: 'SSR', effect: 'charge', desc: '冲锋至敌阵中心，对小范围内所有敌人造成200%伤害并将其击退', applicableFactions: ['魏'], heroMatch: ['张辽'], cooldown: 3 },
  { id: 't020', name: '洛神赋', type: '主动', rarity: 'SSR', effect: 'control_dot', desc: '召唤水系法术，对敌方全体造成120%智力伤害并有50%概率附加"潮湿"（受到火伤+50%）', applicableFactions: ['魏'], heroMatch: ['甄姬'], cooldown: 3 },

  // ===== SR 级别战法 =====
  { id: 't021', name: '断粮之道', type: '主动', rarity: 'SR', effect: 'debuff', desc: '切断敌方补给线，使目标每回合恢复效果降低80%，持续3回合', applicableFactions: ['魏'], heroMatch: ['徐晃'], cooldown: 3 },
  { id: 't022', name: '苦肉计', type: '自毁', rarity: 'SR', effect: 'burst', desc: '牺牲自身30%当前生命值，对敌方全体造成等同于牺牲值300%的真实伤害', applicableFactions: ['吴'], heroMatch: ['黄盖'], cooldown: 5 },
  { id: 't023', name: '巧变', type: '被动', rarity: 'SR', effect: 'flex', desc: '根据对手阵容自动调整站位和策略，获得对应抗性加成', applicableFactions: ['魏'], heroMatch: ['张郃'], cooldown: 0 },
  { id: 't024', name: '反骨', type: '被动', rarity: 'SR', effect: 'risk', desc: '暴击率和暴击伤害各提升25%，但每回合有15%概率进入混乱状态', applicableFactions: ['蜀'], heroMatch: ['魏延'], cooldown: 0 },
  { id: 't025', name: '白马义从', type: '被动', rarity: 'SR', effect: 'mobility', desc: '回避率提升20%，被攻击时有30%概率闪避普通攻击', applicableFactions: ['群'], heroMatch: ['公孙瓒'], cooldown: 0 },
  { id: 't026', name: '太平要术', type: '主动', rarity: 'SSR', effect: 'dot', desc: '以黄天之力诅咒敌方全体，每回合受到最大生命值8%的暗影伤害，持续4回合', applicableFactions: ['群'], heroMatch: ['张角'], cooldown: 4 },
  { id: 't027', name: '连环计', type: '主动', rarity: 'SSR', effect: 'chain', desc: '将2-3个敌方单位用铁链连接，其中任一受到的伤害会传递给其他连接目标（50%传递率）', applicableFactions: ['蜀'], heroMatch: ['庞统'], cooldown: 4 },
  { id: 't028', name: '闭月羞花', type: '控制', rarity: 'SSR', effect: 'charm', desc: '魅惑敌方武力最高的男性武将，使其有60%概率攻击其队友，持续2回合', applicableFactions: ['群'], heroMatch: ['貂蝉'], cooldown: 3 },
  { id: 't029', name: '王佐之才', type: '指挥', rarity: 'SSR', effect: 'team_buff', desc: '战斗全程使我方全体攻击力和智力各提升15%，且技能冷却时间缩短1回合', applicableFactions: ['魏'], heroMatch: ['荀彧'], cooldown: 0 },
  { id: 't030', name: '天妒英才', type: '被动', rarity: 'SSR', effect: 'debuff_enemy', desc: '战斗开始时，使敌方随机2个单位攻击力降低20%，持续全场', applicableFactions: ['魏'], heroMatch: ['郭嘉'], cooldown: 0 },

  // ===== R 级通用战法 =====
  { id: 't031', name: '据守', type: '被动', rarity: 'R', effect: 'def_up', desc: '防御力提升20%，但移动速度降低10%', applicableFactions: [], heroMatch: [], cooldown: 0 },
  { id: 't032', name: '突击', type: '主动', rarity: 'R', effect: 'dmg_up', desc: '下次攻击伤害提升40%', applicableFactions: [], heroMatch: [], cooldown: 2 },
  { id: 't033', name: '固守', type: '被动', rarity: 'R', effect: 'hp_up', desc: '最大生命值提升15%', applicableFactions: [], heroMatch: [], cooldown: 0 },
  { id: 't034', name: '疾袭', type: '被动', rarity: 'R', effect: 'spd_up', desc: '速度提升15%，先手概率提升', applicableFactions: [], heroMatch: [], cooldown: 0 },
  { id: 't035', name: '铁壁', type: '反制', rarity: 'R', effect: 'dmg_down', desc: '受到的单次伤害超过最大生命值的15%时，超出部分减免50%', applicableFactions: [], heroMatch: [], cooldown: 0 },
  { id: 't036', name: '激励', type: '指挥', rarity: 'R', effect: 'team_atk', desc: '相邻友军攻击力提升10%', applicableFactions: [], heroMatch: [], cooldown: 0 },
  { id: 't037', name: '威慑', type: '被动', rarity: 'R', effect: 'enemy_debuf', desc: '周围一格内敌方攻击力降低8%', applicableFactions: [], heroMatch: [], cooldown: 0 },
  { id: 't038', name: '急救', type: '主动', rarity: 'R', effect: 'heal_single', desc: '为一名友军回复15%最大生命值', applicableFactions: [], heroMatch: [], cooldown: 2 },
  { id: 't039', name: '毒计', type: '主动', rarity: 'SR', effect: 'poison', desc: '使目标中毒，每回合损失施法者智力*50%的生命值，持续3回合', applicableFactions: ['魏'], heroMatch: ['贾诩'], cooldown: 3 },
  { id: 't040', name: '疑城之计', type: '指挥', rarity: 'SSR', effect: 'visual_debuff', desc: '在战场上制造虚假城池幻象，使敌方命中率降低25%', applicableFactions: ['吴'], heroMatch: ['徐盛'], cooldown: 0 },
];

/**
 * 战法效果类型枚举
 */
const TACTIC_EFFECTS = {
  // 输出类
  single:    { label: '单体输出', icon: '⚔️', color: '#e74c3c' },
  aoe:       { label: '群体输出', icon: '💥', color: '#e74c3c' },
  multi:     { label: '多段攻击', icon: '🗡️', color: '#c0392b' },
  snipe:     { label: '狙击', icon: '🎯', color: '#e67e22' },
  burst:     { label: '爆发', icon: '💢', color: '#d35400' },
  dot:       { label: '持续伤害', icon: '🔥', color: '#e74c3c' },
  poison:    { label: '中毒', icon: '☠️', color: '#8e44ad' },
  chain:     { label: '连锁', icon: '⛓️', color: '#9b59b6' },
  
  // 控制类
  control:   { label: '控制', icon: '🌀', color: '#3498db' },
  charm:     { label: '魅惑', icon: '💕', color: '#e91e63' },
  silence:   { label: '沉默', icon: '🤫', color: '#95a5a6' },
  
  // 增益类
  buff:      { label: '增益', icon: '📈', color: '#27ae60' },
  team_buff: { label: '团队增益', icon: '🛡️', color: '#27ae60' },
  heal:      { label: '治疗', icon: '💚', color: '#2ecc71' },
  grow:      { label: '成长', icon: '📊', color: '#1abc9c' },
  speed:     { label: '加速', icon: '⚡', color: '#f1c40f' },
  flex:      { label: '应变', icon: '🔄', color: '#3498db' },
  
  // 防御类
  tank:      { label: '坦克', icon: '🏰', color: '#7f8c8d' },
  survive:   { label: '生存', icon: '❤️‍🩹', color: '#e74c3c' },
  reflect:   { label: '反伤', icon: '🪞', color: '#f39c12' },
  pierce:    { label: '穿透', icon: '🔱', color: '#2980b9' },
  mobility:  { label: '机动', icon: '💨', color: '#00bcd4' },
  
  // 特殊类
  assassin:  { label: '刺杀', icon: '🗡️', color: '#2c3e50' },
  charge:    { label: '冲锋', icon: '🐎', color: '#d35400' },
  risk:      { label: '冒险', icon: '🎲', color: '#e67e22' },
  self_destruct: { label: '自毁', icon: '💀', color: '#c0392b' },
};

// 战法类型列表
const TACTIC_TYPES = ['指挥', '主动', '被动', '反制', '突进', '控制'];

/**
 * 按效果类型筛选战法
 */
function getTacticsByEffect(effect) {
  if (!effect || effect === 'all') return ALL_TACTICS;
  return ALL_TACTICS.filter(t => t.effect === effect);
}

/**
 * 按稀有度筛选战法
 */
function getTacticsByRarity(rarity) {
  if (!rarity || rarity === 'all') return ALL_TACTICS;
  return ALL_TACTICS.filter(t => t.rarity === rarity);
}

/**
 * 搜索战法
 */
function searchTactics(keyword) {
  if (!keyword) return ALL_TACTICS;
  const kw = keyword.toLowerCase();
  return ALL_TACTICS.filter(t =>
    t.name.includes(kw) ||
    (t.desc && t.desc.toLowerCase().includes(kw)) ||
    (t.heroMatch && t.heroMatch.some(h => h.toLowerCase().includes(kw)))
  );
}

/**
 * 判断两个战法之间的配合度 (0-1)
 */
function getTacticSynergy(tactic1Name, tactic2Name) {
  const t1 = ALL_TACTICS.find(t => t.name === tactic1Name);
  const t2 = ALL_TACTICS.find(t => t.name === tactic2Name);
  if (!t1 || !t2) return 0;
  
  let synergy = 0;
  // 同阵营加分
  const commonFactions = t1.applicableFactions.filter(f => t2.applicableFactions.includes(f));
  synergy += commonFactions.length * 0.1;
  
  // 效果互补加分
  const goodCombos = [
    [['control','charm'], ['single','burst','snipe']],  // 控制+输出
    [['dot','poison'], ['aoe']],                          // DOT+AOE
    [['buff','team_buff'], ['single','aoe','multi']],    // 增益+输出
    [['heal'], ['tank','survive','reflect']],             // 治疗+坦克
    [['silence'], ['aoe','dot']],                        // 沉默+DOT
  ];
  for (const [groupA, groupB] of goodCombos) {
    if (groupA.includes(t1.effect) && groupB.includes(t2.effect)) synergy += 0.3;
    if (groupB.includes(t1.effect) && groupA.includes(t2.effect)) synergy += 0.3;
  }
  
  return Math.min(synergy, 1);
}

console.log('[data_tactics] 已加载', ALL_TACTICS.length, '个战法数据');

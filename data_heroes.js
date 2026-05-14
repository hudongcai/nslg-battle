/**
 * 武将数据库 - 三国谋定天下
 * 包含全部武将的属性、阵营、品质、技能信息
 * 用于克制分析和武将库展示
 */
var ALL_HEROES = [
  // ===== 群雄 =====
  { id: 'h001', name: '吕布', faction: '群', rarity: 'SSR', specialty: '骑兵', skills: ['无双战神','天下无双'], counter: ['张辽','关羽'], weakTo: ['貂蝉'], desc: '武力巅峰，输出极高但需要保护' },
  { id: 'h002', name: '貂蝉', faction: '群', rarity: 'SSR', specialty: '辅助', skills: ['闭月羞花','倾国倾城'], counter: ['吕布','董卓'], weakTo: ['王允','荀彧'], desc: '控制型辅助，可削弱敌方' },
  { id: 'h003', name: '董卓', faction: '群', rarity: 'SSR', specialty: '坦克', skills: ['暴虐无道','魔王降临'], counter: ['华雄','李傕'], weakTo: ['吕布','王允','曹操'], desc: '高血量前排，适合站桩' },
  { id: 'h004', name: '华雄', faction: '群', rarity: 'SR', specialty: '战士', skills: ['魔将之威','不可一世'], counter: [], weakTo: ['孙坚','关羽'], desc: '前期可用战将' },
  { id: 'h005', name: '袁绍', faction: '群', rarity: 'SSR', specialty: '法师', skills: ['四世三公','河北霸主'], counter: ['公孙瓒','韩馥'], weakTo: ['曹操'], desc: '群体法术伤害' },
  { id: 'h006', name: '袁术', faction: '群', rarity: 'SR', specialty: '法师', skills: ['仲家皇帝','僭越称帝'], counter: [], weakTo: [], desc: '中规中矩的法系' },
  { id: 'h007', name: '公孙瓒', faction: '群', rarity: 'SR', specialty: '骑兵', skills: ['白马义从','塞北飞骑'], counter: ['乌桓鲜卑'], weakTo: ['袁绍'], desc: '机动性强的骑兵' },
  { id: 'h008', name: '左慈', faction: '群', rarity: 'SSR', specialty: '辅助', skills: ['遁甲天书','幻术大师'], counter: [], weakTo: [], desc: '神秘辅助，可复制敌方技能' },
  { id: 'h009', name: '于吉', faction: '群', rarity: 'SR', specialty: '辅助', skills: ['太平道术','蛊惑人心'], counter: [], weakTo: [], desc: '治疗+增益辅助' },
  { id: 'h010', name: '张角', faction: '群', rarity: 'SSR', specialty: '法师', skills: ['太平要术','黄天当立'], counter: [], weakTo: ['刘备','曹操'], desc: '强力法系输出，持续伤害' },

  // ===== 魏 =====
  { id: 'h011', name: '曹操', faction: '魏', rarity: 'SSR', specialty: '全能', skills: ['奸雄','乱世枭雄'], counter: ['袁绍','吕布','张绣'], weakTo: ['周瑜','诸葛亮'], desc: '万金油，攻防一体' },
  { id: 'h012', name: '司马懿', faction: '魏', rarity: 'SSR', specialty: '法师', skills: ['狼顾之相','鹰视狼顾'], counter: ['诸葛亮','曹真'], weakTo: [], desc: '后期法核，越战越强' },
  { id: 'h013', name: '郭嘉', faction: '魏', rarity: 'SSR', specialty: '辅助', skills: ['天妒英才','遗计定北'], counter: ['袁绍','吕布'], weakTo: [], desc: '顶级谋士辅助，控场+增伤' },
  { id: 'h014', name: '夏侯惇', faction: '魏', rarity: 'SSR', specialty: '战士', skills: ['拔矢啖睛','独目苍狼'], counter: [], weakTo: ['关羽','赵云'], desc: '硬派前排，反伤能力' },
  { id: 'h015', name: '夏侯渊', faction: '魏', rarity: 'SSR', specialty: '射手', skills: ['神行千里','疾射先锋'], counter: [], weakTo: [], desc: '高速射手，先手优势' },
  { id: 'h016', name: '张辽', faction: '魏', rarity: 'SSR', specialty: '骑兵', skills: ['威震逍遥津','突袭先锋'], counter: ['甘宁','太史慈'], weakTo: [], desc: '突进型刺客，切后排' },
  { id: 'h017', name: '许褚', faction: '魏', rarity: 'SSR', specialty: '坦克', skills: ['裸衣斗神','虎痴之力'], counter: [], weakTo: ['马超','赵云'], desc: '超高坦度，纯肉盾' },
  { id: 'h018', name: '典韦', faction: '魏', rarity: 'SSR', specialty: '战士', skills: ['恶来之勇','古之恶来'], counter: [], weakTo: [], desc: '爆发型战士，贴脸输出' },
  { id: 'h019', name: '张郃', faction: '魏', rarity: 'SR', specialty: '步兵', skills: ['巧变','料敌机先'], counter: [], weakTo: [], desc: '灵活应变型副C' },
  { id: 'h020', name: '徐晃', faction: '魏', rarity: 'SR', specialty: '步兵', skills: ['断粮之道','治军严明'], counter: [], weakTo: [], desc: '防守反击型战士' },
  { id: 'h021', name: '荀彧', faction: '魏', rarity: 'SSR', specialty: '辅助', skills: ['王佐之才','驱虎吞狼'], counter: [], weakTo: [], desc: '顶级增益辅助，提升全队输出' },
  { id: 'h022', name: '荀攸', faction: '魏', rarity: 'SR', specialty: '辅助', skills: ['十二奇策','谋主'], counter: [], weakTo: [], desc: '控场型谋士' },
  { id: 'h023', name: '贾诩', faction: '魏', rarity: 'SSR', specialty: '法师', skills: ['算无遗策','毒士'], counter: [], weakTo: [], desc: '毒伤+混乱，非常规法师' },
  { id: 'h024', name: '于禁', faction: '魏', rarity: 'R', specialty: '步兵', skills: ['毅重','节钺'], counter: [], weakTo: [], desc: '稳健型前排' },
  { id: 'h025', name: '李典', faction: '魏', rarity: 'R', specialty: '步兵', skills: ['不忘师训','博学多闻'], counter: [], weakTo: [], desc: '学识型武将' },
  { id: 'h026', name: '乐进', faction: '魏', rarity: 'R', specialty: '战士', skills: ['勇猛果敢','每战先登'], counter: [], weakTo: [], desc: '冲锋陷阵型猛将' },
  { id: 'h027', name: '曹仁', faction: '魏', rarity: 'SSR', specialty: '坦克', skills: ['八门金锁','据守待援'], counter: [], weakTo: [], desc: '最强防御型坦克之一' },
  { id: 'h028', name: '曹洪', faction: '魏', rarity: 'R', specialty: '战士', skills: ['护卫之心','舍命救主'], counter: [], weakTo: [], desc: '护卫型副T' },
  { id: 'h029', name: '甄姬', faction: '魏', rarity: 'SSR', specialty: '法师', skills: ['洛神赋','流风回雪'], counter: [], weakTo: [], desc: '水系法术+控制' },
  { id: 'h030', name: '邓艾', faction: '魏', rarity: 'SR', specialty: '步兵', skills: ['偷渡阴平','暗度陈仓'], counter: [], weakTo: [], desc: '奇兵型武将' },

  // ===== 蜀 =====
  { id: 'h031', name: '刘备', faction: '蜀', rarity: 'SSR', specialty: '辅助', skills: ['仁德之君','携民渡江'], counter: ['张角','各种混乱效果'], weakTo: ['曹操','吕布'], desc: '团队核心辅助，治疗+护盾' },
  { id: 'h032', name: '诸葛亮', faction: '蜀', rarity: 'SSR', specialty: '法师', skills: ['卧龙','八阵图'], counter: ['司马懿','曹操'], weakTo: [], desc: '全能法师，控场+输出+辅助' },
  { id: 'h033', name: '关羽', faction: '蜀', rarity: 'SSR', specialty: '战士', skills: ['武圣','青龙偃月'], counter: ['华雄','颜良','文丑','蔡阳'], weakTo: ['徐盛','吕蒙'], desc: '单挑之王，单点爆发极高' },
  { id: 'h034', name: '张飞', faction: '蜀', rarity: 'SSR', specialty: '坦克', skills: ['万人敌','咆哮长坂'], counter: [], weakTo: [], desc: '硬控型前排，群体恐惧' },
  { id: 'h035', name: '赵云', faction: '蜀', rarity: 'SSR', specialty: '骑兵', skills: ['常山赵子龙','七进七出'], counter: [], weakTo: [], desc: '全能型武将，攻守兼备' },
  { id: 'h036', name: '马超', faction: '蜀', rarity: 'SSR', specialty: '骑兵', skills: ['锦马超','西凉铁骑'], counter: ['许褚','曹洪'], weakTo: [], desc: '高速高伤骑兵，攻势凌厉' },
  { id: 'h037', name: '黄忠', faction: '蜀', rarity: 'SSR', specialty: '射手', skills: ['老当益壮','百步穿杨'], counter: [], weakTo: [], desc: '超高单体伤害射手' },
  { id: 'h038', name: '魏延', faction: '蜀', rarity: 'SR', specialty: '战士', skills: ['反骨','子午谷奇谋'], counter: [], weakTo: [], desc: '高风险高收益型' },
  { id: 'h039', name: '庞统', faction: '蜀', rarity: 'SSR', specialty: '法师', skills: ['凤雏','连环计'], counter: [], weakTo: [], desc: '策略型法师，连锁伤害' },
  { id: 'h040', name: '姜维', faction: '蜀', rarity: 'SSR', specialty: '骑兵', skills: ['幼麟','继承丞相遗志'], counter: [], weakTo: [], desc: '文武双全，继承诸葛衣钵' },
  { id: 'h041', name: '法正', faction: '蜀', rarity: 'SR', specialty: '辅助', skills: ['睚眦必报','以法绳之'], counter: [], weakTo: [], desc: '强力控场辅助' },
  { id: 'h042', name: '刘禅', faction: '蜀', rarity: 'SR', specialty: '辅助', skills: ['阿斗','扶不起'], counter: [], weakTo: [], desc: '搞笑型治疗辅助' },
  { id: 'h043', name: '关兴', faction: '蜀', rarity: 'R', specialty: '战士', skills: ['龙腾虎跃','父仇'], counter: [], weakTo: [], desc: '二代武将' },
  { id: 'h044', name: '张苞', faction: '蜀', rarity: 'R', specialty: '战士', skills: ['猛虎下山','复仇'], counter: [], weakTo: [], desc: '二代武将' },
  { id: 'h045', name: '马岱', faction: '蜀', rarity: 'R', specialty: '骑兵', skills: ['斩魏延','西凉骁骑'], counter: [], weakTo: [], desc: '快速斩杀型' },
  { id: 'h046', name: '徐庶', faction: '蜀', rarity: 'SR', specialty: '辅助', skills: ['徐元直','身在曹营心在汉'], counter: [], weakTo: [], desc: '智谋型辅助' },
  { id: 'h047', name: '蒋琬', faction: '蜀', rarity: 'R', specialty: '辅助', skills: ['社稷之器','安邦治国'], counter: [], weakTo: [], desc: '内政型辅助' },
  { id: 'h048', name: '费祎', faction: '蜀', rarity: 'R', specialty: '辅助', skills: ['外交天才','以和为贵'], counter: [], weakTo: [], desc: '外交型辅助' },
  { id: 'h049', name: '孟获', faction: '蜀', rarity: 'SR', specialty: '坦克', skills: ['南蛮王','藤甲兵'], counter: [], weakTo: ['诸葛亮(火攻)'], desc: '高防但怕火' },
  { id: 'h050', name: '祝融', faction: '蜀', rarity: 'SR', specialty: '战士', skills: ['火神之女','飞刀'], counter: [], weakTo: [], desc: '南蛮女战神' },

  // ===== 吴 =====
  { id: 'h051', name: '孙权', faction: '吴', rarity: 'SSR', specialty: '全能', skills: ['碧眼紫髯','制衡'], counter: ['刘备','张辽'], weakTo: [], desc: '均衡型君主，适应性强' },
  { id: 'h052', name: '周瑜', faction: '吴', rarity: 'SSR', specialty: '法师', skills: ['大都督','火烧赤壁'], counter: ['曹操','蔡瑁','张允'], weakTo: [], desc: '火系法王，群体爆发' },
  { id: 'h053', name: '陆逊', faction: '吴', rarity: 'SSR', specialty: '法师', skills: ['儒生大将','火烧连营'], counter: ['刘备','关羽'], weakTo: [], desc: '持续燃烧型法核' },
  { id: 'h054', name: '吕蒙', faction: '吴', rarity: 'SSR', specialty: '步兵', skills: ['白衣渡江','士别三日'], counter: ['关羽','樊城'], weakTo: [], desc: '克制关羽的特化武将' },
  { id: 'h055', name: '鲁肃', faction: '吴', rarity: 'SSR', specialty: '辅助', skills: ['榻上策','联盟'], counter: [], weakTo: [], desc: '战略型辅助' },
  { id: 'h056', name: '甘宁', faction: '吴', rarity: 'SSR', specialty: '战士', skills: ['锦帆贼','百劫不死'], counter: [], weakTo: ['张辽'], desc: '狂战士型输出' },
  { id: 'h057', name: '太史慈', faction: '吴', rarity: 'SSR', specialty: '射手', skills: ['信义笃烈','神射无敌'], counter: [], weakTo: [], desc: '高攻速射手' },
  { id: 'h058', name: '孙策', faction: '吴', rarity: 'SSR', specialty: '骑兵', skills: ['小霸王','霸王之气'], counter: [], weakTo: [], desc: '突击型骑兵领袖' },
  { id: 'h059', name: '黄盖', faction: '吴', rarity: 'SR', specialty: '战士', skills: ['苦肉计','诈降'], counter: ['曹操(赤壁)'], weakTo: [], desc: '自残型爆发' },
  { id: 'h060', name: '程普', faction: '吴', rarity: 'SR', specialty: '坦克', skills: ['三朝元老','老当益壮'], counter: [], weakTo: [], desc: '稳定前排' },
  { id: 'h061', name: '韩当', faction: '吴', rarity: 'R', specialty: '战士', skills: ['忠勤','江东老将'], counter: [], weakTo: [], desc: '可靠的前排' },
  { id: 'h062', name: '周泰', faction: '吴', rarity: 'SSR', specialty: '坦克', skills: ['不死之身','肉身护主'], counter: [], weakTo: [], desc: '极难击杀的超级肉盾' },
  { id: 'h063', name: '凌统', faction: '吴', rarity: 'SR', specialty: '骑兵', skills: ['国士之风','死战不退'], counter: [], weakTo: [], desc: '决死型突击' },
  { id: 'h064', name: '徐盛', faction: '吴', rarity: 'SSR', specialty: '步兵', skills: ['破敌火舟','疑城之计'], counter: ['关羽'], weakTo: [], desc: '火攻克制物理' },
  { id: 'h065', name: '丁奉', faction: '吴', rarity: 'R', specialty: '步兵', skills: ['雪夜奋短兵','斩将立功'], counter: [], weakTo: [], desc: '雪中奇袭型' },
  { id: 'h066', name: '朱然', faction: '吴', rarity: 'SR', specialty: '坦克', skills: ['胆守不死','坚守不出'], counter: [], weakTo: [], desc: '防守型前排' },
  { id: 'h067', name: '诸葛恪', faction: '吴', rarity: 'SR', specialty: '法师', skills: ['聪明伶俐','专断独行'], counter: [], weakTo: [], desc: '高智商但傲慢的法系' },
  { id: 'h068', name: '大乔', faction: '吴', rarity: 'SSR', specialty: '辅助', skills: ['国色天香','流离'], counter: [], weakTo: [], desc: '控制型女辅助' },
  { id: 'h069', name: '小乔', faction: '吴', rarity: 'SSR', specialty: '辅助', skills: ['天香国色','琴音'], counter: [], weakTo: [], desc: '增益型女辅助' },
  { id: 'h070', name: '孙尚香', faction: '吴', rarity: 'SSR', specialty: '射手', skills: ['弓腰姬','枭姬'], counter: [], weakTo: [], desc: '攻速型远程输出' },

  // ===== 汉其他 =====
  { id: 'h071', name: '王允', faction: '汉', rarity: 'SR', specialty: '辅助', skills: ['连环计','除贼'], counter: ['董卓','吕布(被离间后)'], weakTo: [], desc: '离间型策略辅助' },
  { id: 'h072', name: '陈宫', faction: '汉', rarity: 'SR', specialty: '辅助', skills: ['智者千虑','择主而事'], counter: [], weakTo: [], desc: '谋略型辅助' },
  { id: 'h073', name: '陈琳', faction: '群', rarity: 'R', specialty: '辅助', skills: ['檄文','骂阵'], counter: [], weakTo: [], desc: 'debuff型辅助' },
];

/**
 * 按阵营获取武将列表
 */
function getHeroesByFaction(faction) {
  if (!faction || faction === 'all') return ALL_HEROES;
  return ALL_HEROES.filter(h => h.faction === faction);
}

/**
 * 搜索武将（按名称或技能模糊匹配）
 */
function searchHeroes(keyword) {
  if (!keyword) return ALL_HEROES;
  const kw = keyword.toLowerCase();
  return ALL_HEROES.filter(h =>
    h.name.toLowerCase().includes(kw) ||
    h.skills.some(s => s.toLowerCase().includes(kw)) ||
    (h.desc && h.desc.toLowerCase().includes(kw)) ||
    (h.specialty && h.specialty.includes(kw))
  );
}

/**
 * 获取武将的克制关系
 */
function getHeroCounterInfo(heroName) {
  const hero = ALL_HEROES.find(h => h.name === heroName);
  if (!hero) return null;
  return {
    name: hero.name,
    counters: hero.counter || [],      // 我克制的敌人
    weakTo: hero.weakTo || [],          // 克制我的敌人
    faction: hero.faction,
    rarity: hero.rarity,
    skills: hero.skills
  };
}

/**
 * 判断两个武将之间的克制关系
 * 返回值: 1=hero1克hero2, -1=hero2克hero1, 0=无明显克制
 */
function getCounterRelation(hero1Name, hero2Name) {
  const h1 = ALL_HEROES.find(h => h.name === hero1Name);
  const h2 = ALL_HEROES.find(h => h.name === hero2Name);
  if (!h1 || !h2) return 0;
  if (h1.counter && h1.counter.includes(h2.name)) return 1;
  if (h1.weakTo && h1.weakTo.includes(h2.name)) return -1;
  // 阵营基础克制：群>蜀>吴>魏>群（剪刀石头布）
  const factionCycle = { '群': '蜀', '蜀': '吴', '吴': '魏', '魏': '群' };
  if (factionCycle[h1.faction] === h2.faction) return 0.5;  // 微弱优势
  if (factionCycle[h2.faction] === h1.faction) return -0.5;
  return 0;
}

// 阵营列表
const FACTIONS = [
  { key: 'all', label: '全部', color: '#999' },
  { key: '魏', label: '魏', color: '#4a90d9' },
  { key: '蜀', label: '蜀', color: '#e74c3c' },
  { key: '吴', label: '吴', color: '#27ae60' },
  { key: '群', label: '群', color: '#9b59b6' },
  { key: '汉', label: '汉', color: '#f39c12' },
];

// 品质列表
const RARITIES = ['SSR', 'SR', 'R'];

console.log('[data_heroes] 已加载', ALL_HEROES.length, '个武将数据');

#!/usr/bin/env python3
# 修复 parseOCRResponse 中的冒号支持和同盟/结果解析

with open('ocr-system.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 修复1: 支持全角和半角冒号
old1 = "    const ci = line.indexOf('：');\n    if (ci === -1) continue;"
new1 = "    // 支持全角：和半角 : 两种冒号\n    let ci = line.indexOf('：');\n    if (ci === -1) ci = line.indexOf(':');\n    if (ci === -1) continue;"
if old1 in content:
    content = content.replace(old1, new1)
    print('✅ 修复1: 冒号支持')
else:
    print('⚠️ 修复1: 未找到目标字符串')

# 修复2: 同盟解析（在玩家解析之前处理）
old2 = """    if (key.includes('玩家') || key.includes('玩家名')) {
      // 支持 "真武|憨憨牛" 格式，取 | 后面部分作为玩家名
      let name = val;
      if (name.includes('|')) name = name.split('|').pop().trim();
      if (side === 'left') { record.leftPlayer = name; }
      else if (side === 'right') { record.rightPlayer = name; }
    } else if (key.includes('同盟') || key.includes('联盟')) {"""
new2 = """    if (key.includes('同盟') || key.includes('联盟')) {
      // 同盟：取 | 前面部分，如"真武|憨憨牛" → 同盟="真武"
      let alliance = val;
      if (alliance.includes('|')) alliance = alliance.split('|')[0].trim();
      if (side === 'left') { record.leftAlliance = alliance; }
      else if (side === 'right') { record.rightAlliance = alliance; }
    } else if (key.includes('玩家') || key.includes('玩家名')) {
      // 玩家：取 | 后面部分，如"真武|憨憨牛" → 玩家="憨憨牛"
      let name = val;
      if (name.includes('|')) name = name.split('|').pop().trim();
      if (side === 'left') { record.leftPlayer = name; }
      else if (side === 'right') { record.rightPlayer = name; }
    } else if (key.includes('同盟') || key.includes('联盟')) {"""
if old2 in content:
    content = content.replace(old2, new2)
    print('✅ 修复2: 同盟解析')
else:
    print('⚠️ 修复2: 未找到目标字符串（可能已修复）')

# 修复3: 结果解析更健壮
old3 = """    } else if ((key.includes('胜负') || key.includes('结果')) && side === 'result') {
      if (val.includes('胜')) record.result = '胜';
      else if (val.includes('败')) record.result = '败';
      else record.result = '平';"""
new3 = """    } else if (side === 'result' && (key.includes('胜负') || key.includes('结果') || key === '')) {
      // 结果区：直接识别值中的 胜/败/平
      if (!record.result && val) {
        if (val.includes('胜') && !val.includes('胜率')) record.result = '胜';
        else if (val.includes('败')) record.result = '败';
        else if (val.includes('平')) record.result = '平';
      }
    } else if ((key.includes('胜负') || key.includes('结果')) && side === 'result') {
      if (val.includes('胜') && !val.includes('胜率')) record.result = '胜';
      else if (val.includes('败')) record.result = '败';
      else record.result = '平';"""
if old3 in content:
    content = content.replace(old3, new3)
    print('✅ 修复3: 结果解析')
else:
    print('⚠️ 修复3: 未找到目标字符串（可能已修复）')

with open('ocr-system.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('\n✅ ocr-system.js 修复完成')

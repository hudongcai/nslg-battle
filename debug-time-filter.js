// 调试时间过滤功能
console.log('=== 时间过滤调试工具 ===');

// 1. 检查数据
if (typeof allRecords !== 'undefined' && allRecords.length > 0) {
  console.log('✓ allRecords 已加载，共', allRecords.length, '条');

  // 显示前3条记录的时间字段
  console.log('\n前3条记录的时间字段：');
  allRecords.slice(0, 3).forEach((r, i) => {
    console.log(`记录${i+1}:`, {
      id: r.id,
      time: r.time,
      timeType: typeof r.time
    });
  });

  // 统计有时间字段的记录数
  const withTime = allRecords.filter(r => r.time).length;
  console.log(`\n有time字段的记录: ${withTime} / ${allRecords.length}`);

} else {
  console.error('✗ allRecords 未定义或为空');
}

// 2. 检查过滤函数
console.log('\n=== 过滤函数检查 ===');
console.log('getFilteredRecordsForWinrate:', typeof getFilteredRecordsForWinrate);
console.log('parseRecordDate:', typeof parseRecordDate);

// 3. 测试parseRecordDate函数
if (typeof parseRecordDate === 'function' && allRecords && allRecords.length > 0) {
  console.log('\n=== 测试 parseRecordDate ===');
  allRecords.slice(0, 5).forEach((r, i) => {
    const parsed = parseRecordDate(r);
    console.log(`记录${i+1}: time="${r.time}" -> ${parsed ? parsed.toLocaleDateString() : 'null'}`);
  });
}

// 4. 测试过滤
if (typeof getFilteredRecordsForWinrate === 'function') {
  console.log('\n=== 测试过滤功能 ===');

  // 测试1: 无过滤
  const all = getFilteredRecordsForWinrate();
  console.log('无过滤时:', all.length, '条');

  // 测试2: 设置最近3天
  if (typeof setWinrateDateRange === 'function') {
    setWinrateDateRange(3);
    setTimeout(() => {
      const filtered = getFilteredRecordsForWinrate();
      console.log('过滤最近3天后:', filtered.length, '条');
      console.log('过滤器状态:', {
        start: winrateDateStart,
        end: winrateDateEnd
      });
    }, 100);
  }
}

// 5. 检查UI元素
console.log('\n=== UI元素检查 ===');
const elements = {
  caDateStart: document.getElementById('caDateStart'),
  caDateEnd: document.getElementById('caDateEnd'),
  caDateInfo: document.getElementById('caDateInfo'),
  wrDateStart: document.getElementById('wrDateStart'),
  wrDateEnd: document.getElementById('wrDateEnd')
};

Object.entries(elements).forEach(([name, el]) => {
  console.log(`${name}:`, el ? '✓ 存在' : '✗ 不存在', el?.value || '');
});

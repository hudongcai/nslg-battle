// 这个脚本需要在浏览器控制台运行，用于检查当前画布配置

console.log('=== 检查当前画布配置 ===\n');

// 检查 localStorage 中的方案
const schemeNames = JSON.parse(localStorage.getItem('le_scheme_list') || '[]');
console.log('1. localStorage 中的方案列表：');
if (schemeNames.length === 0) {
  console.log('  ❌ 没有任何方案');
} else {
  console.log(`  找到 ${schemeNames.length} 个方案:`);
  schemeNames.forEach(name => console.log(`    - ${name}`));
}

// 检查当前选中的方案
const selectedScheme = document.getElementById('leSchemeSelect')?.value;
console.log(`\n2. 当前选中的方案: ${selectedScheme || '(未选择)'}`);

// 检查画布上的豆豆配置
if (typeof _leBoxes !== 'undefined') {
  console.log('\n3. 画布上的豆豆(stars)区域配置：');
  const starsBoxes = _leBoxes.filter(b => b.def.cat === 'stars');
  if (starsBoxes.length === 0) {
    console.log('  ❌ 画布上没有豆豆区域');
  } else {
    starsBoxes.forEach(b => {
      console.log(`  ${b.def.key} (${b.def.label}):`);
      console.log(`    rx1=${b.rx1.toFixed(4)}, ry1=${b.ry1.toFixed(4)}, rx2=${b.rx2.toFixed(4)}, ry2=${b.ry2.toFixed(4)}`);
    });
  }
} else {
  console.log('\n3. ⚠️ _leBoxes 未定义（可能未进入编辑器页面）');
}

// 检查当前项目ID
if (typeof _leProjectId !== 'undefined') {
  console.log(`\n4. 当前项目ID: ${_leProjectId === 0 ? '全局配置' : _leProjectId}`);
}

// 检查是否有上传的图片
if (typeof _leCurrentImageB64 !== 'undefined') {
  console.log(`\n5. 当前图片: ${_leCurrentImageB64 ? '已上传' : '未上传'}`);
}

console.log('\n=== 检查完成 ===');
console.log('\n如果方案已还原但测试失败，请执行：');
console.log('1. 在方案下拉框中选择"数据库全局配置"');
console.log('2. 重新上传测试图片');
console.log('3. 再次测试');

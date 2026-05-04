/**
 * 诊断脚本 v2 - 深度检查 DOM 结构
 */
function diagnose() {
  console.clear();
  console.log('%c=== 深度诊断开始 ===', 'color:blue;font-weight:bold;font-size:14px');

  // 1. 检查所有 tab-content 元素的实际位置
  console.log('\n%c[1] 所有 tab-content 元素的父元素:', 'color:green;font-weight:bold');
  document.querySelectorAll('.tab-content').forEach(el => {
    const parent = el.parentElement;
    const parentId = parent.id || parent.className || 'unknown';
    console.log(`  ${el.id} -> 父元素: ${parentId} (${parent.tagName})`);
  });

  // 2. 检查 mainApp 内有哪些直接子元素
  console.log('\n%c[2] mainApp 的直接子元素:', 'color:green;font-weight:bold');
  const mainApp = document.getElementById('mainApp');
  if (mainApp) {
    Array.from(mainApp.children).forEach((child, i) => {
      console.log(`  [${i}] <${child.tagName}> id="${child.id || 'none'}" class="${child.className || 'none'}"`);
    });
  } else {
    console.log('  ❌ mainApp 未找到！');
  }

  // 3. 检查 tab-rolemanage 是否真的存在
  console.log('\n%c[3] tab-rolemanage 查找:', 'color:green;font-weight:bold');
  const roleTab = document.getElementById('tab-rolemanage');
  if (roleTab) {
    console.log('  ✅ tab-rolemanage 存在');
    console.log('  - display:', window.getComputedStyle(roleTab).display);
    console.log('  - parent:', roleTab.parentElement.id || roleTab.parentElement.className);
    console.log('  - innerHTML length:', roleTab.innerHTML.length);
  } else {
    console.log('  ❌ tab-rolemanage 不存在于 DOM 中');
    console.log('  - innerHTML 包含字符串:', document.body.innerHTML.includes('tab-rolemanage'));
  }

  // 4. 检查 tab-datamgmt 的结束位置
  console.log('\n%c[4] tab-datamgmt 的子元素:', 'color:green;font-weight:bold');
  const datamgmt = document.getElementById('tab-datamgmt');
  if (datamgmt) {
    console.log('  tab-datamgmt 的 lastChild:', datamgmt.lastElementChild?.id || datamgmt.lastElementChild?.className);
    // 检查 tab-rolemanage 是否在 tab-datamgmt 内部
    const found = datamgmt.querySelector('#tab-rolemanage');
    console.log('  tab-rolemanage 在 tab-datamgmt 内部?', found ? '✅ 是！这就是问题！' : '❌ 否');
  }

  // 5. 检查 switchTab 函数
  console.log('\n%c[5] switchTab 函数检查:', 'color:green;font-weight:bold');
  if (typeof switchTab === 'function') {
    console.log('  ✅ switchTab 已定义');
    // 尝试读取函数源码（前200字符）
    const src = switchTab.toString().substring(0, 200);
    console.log('  函数签名:', src.split('\n')[0]);
  }

  console.log('\n%c=== 诊断完成 ===', 'color:blue;font-weight:bold');
}

// 自动执行
diagnose();

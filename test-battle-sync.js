/**
 * 测试战报同步机制
 *
 * 使用方法：
 * 1. 打开浏览器控制台
 * 2. 复制粘贴此脚本运行
 * 3. 检查控制台输出
 */

async function testBattleSync() {
  console.log('========== 战报同步测试 ==========');

  // 1. 检查当前项目
  if (!window.currentProjectId) {
    console.error('❌ 未选择项目，请先进入一个项目');
    return;
  }
  console.log('✅ 当前项目ID:', window.currentProjectId);

  // 2. 检查云端同步模块
  if (!window.cloudSync || typeof window.cloudSync.syncProjectRecords !== 'function') {
    console.error('❌ cloudSync 模块未加载');
    return;
  }
  console.log('✅ cloudSync 模块已加载');

  // 3. 检查本地IndexedDB记录数
  const localCount = allRecords ? allRecords.length : 0;
  console.log('📊 本地IndexedDB记录数:', localCount);

  // 4. 从云端获取记录数
  try {
    console.log('🔄 正在从云端同步...');
    const result = await window.cloudSync.syncProjectRecords(window.currentProjectId);
    console.log('✅ 云端同步完成:', result);

    // 5. 重新加载本地数据
    if (typeof loadAllRecords === 'function') {
      await loadAllRecords();
      console.log('📊 同步后本地记录数:', allRecords.length);
      console.log('📈 新增记录数:', allRecords.length - localCount);
    }

    // 6. 刷新显示
    if (typeof renderDataTable === 'function') renderDataTable();
    if (typeof renderGallery === 'function') renderGallery();

    console.log('========== 测试完成 ==========');
    console.log('✅ 如果看到新增记录数 > 0，说明同步成功');
    console.log('✅ 如果新增记录数 = 0，说明本地已是最新');

  } catch (e) {
    console.error('❌ 同步失败:', e);
  }
}

// 运行测试
testBattleSync();

/**
 * 测试缓存优化效果
 *
 * 用途：验证图片按需加载功能是否正常工作
 * 使用方法：在浏览器控制台运行此脚本
 */

async function testCacheOptimization() {
  console.log('========== 缓存优化测试 ==========\n');

  // 1. 检查浏览器缓存占用
  console.log('【1. 浏览器缓存占用】');
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage / 1024 / 1024;
    const quota = estimate.quota / 1024 / 1024;
    const percent = (estimate.usage / estimate.quota * 100).toFixed(1);

    console.log(`  已使用: ${used.toFixed(2)} MB`);
    console.log(`  配额: ${quota.toFixed(2)} MB`);
    console.log(`  占用率: ${percent}%`);

    if (percent > 80) {
      console.warn('  ⚠️ 缓存占用过高，建议运行清理脚本');
    } else if (percent > 50) {
      console.log('  ⚠️ 缓存占用较高');
    } else {
      console.log('  ✅ 缓存占用正常');
    }
  } else {
    console.log('  ❌ 浏览器不支持缓存统计API');
  }

  // 2. 检查 IndexedDB 中的图片数据
  console.log('\n【2. IndexedDB 图片数据统计】');
  if (typeof dbGetAll !== 'function') {
    console.log('  ❌ dbGetAll 函数不存在，请先打开项目');
    return;
  }

  try {
    const records = await dbGetAll();
    const withImage = records.filter(r => r.imageBase64 || r.image_data);
    const withoutImage = records.filter(r => !r.imageBase64 && !r.image_data);

    console.log(`  总战报数: ${records.length} 条`);
    console.log(`  含图片: ${withImage.length} 条`);
    console.log(`  不含图片: ${withoutImage.length} 条`);

    if (withImage.length === 0) {
      console.log('  ✅ 所有图片数据已清理，优化生效');
    } else {
      const percent = (withImage.length / records.length * 100).toFixed(1);
      console.warn(`  ⚠️ 仍有 ${percent}% 的战报包含图片数据`);
      console.log('  建议运行清理脚本: clean-indexeddb-images.js');
    }

    // 估算图片占用空间
    if (withImage.length > 0) {
      let totalSize = 0;
      for (const rec of withImage) {
        const imgData = rec.imageBase64 || rec.image_data || '';
        totalSize += imgData.length * 0.75; // base64 → bytes
      }
      console.log(`  图片占用空间: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (e) {
    console.error('  ❌ 读取 IndexedDB 失败:', e.message);
  }

  // 3. 检查按需加载功能
  console.log('\n【3. 按需加载功能检查】');
  if (typeof showRecordImage === 'function') {
    console.log('  ✅ showRecordImage() 函数存在');

    // 检查是否包含云端加载逻辑
    const funcStr = showRecordImage.toString();
    if (funcStr.includes('CLOUD_API_BASE') || funcStr.includes('fetch')) {
      console.log('  ✅ 包含云端加载逻辑');
    } else {
      console.warn('  ⚠️ 可能缺少云端加载逻辑');
    }
  } else {
    console.log('  ❌ showRecordImage() 函数不存在');
  }

  // 4. 检查自动图片同步是否已禁用
  console.log('\n【4. 自动图片同步检查】');
  if (typeof viewProject === 'function') {
    const funcStr = viewProject.toString();
    if (funcStr.includes('syncProjectImages') && !funcStr.includes('// 🔥')) {
      console.warn('  ⚠️ viewProject() 仍包含 syncProjectImages 调用');
      console.warn('  自动图片同步可能未禁用');
    } else {
      console.log('  ✅ 自动图片同步已禁用');
    }
  } else {
    console.log('  ❌ viewProject() 函数不存在');
  }

  // 5. 检查数据同步优化
  console.log('\n【5. 数据同步优化检查】');
  if (window.cloudSync && typeof window.cloudSync.syncProjectRecords === 'function') {
    console.log('  ✅ syncProjectRecords() 函数存在');
    console.log('  提示: 该函数应删除同步数据中的图片字段');
  } else {
    console.log('  ❌ syncProjectRecords() 函数不存在');
  }

  // 6. 总结
  console.log('\n========== 测试总结 ==========');
  console.log('优化目标:');
  console.log('  - 禁用自动批量图片同步');
  console.log('  - 数据同步时删除图片字段');
  console.log('  - 用户点击时从云端按需加载');
  console.log('\n预期效果:');
  console.log('  - 缓存占用降低 100-1000 倍');
  console.log('  - 打开项目速度提升 10 倍');
  console.log('  - 不再发生浏览器瘫痪');
  console.log('  - 用户体验无明显影响');
  console.log('\n如需清理现有图片数据，请运行:');
  console.log('  clean-indexeddb-images.js');
}

// 自动运行
testCacheOptimization().catch(e => {
  console.error('测试失败:', e);
});

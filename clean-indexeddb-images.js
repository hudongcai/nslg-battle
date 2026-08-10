/**
 * 清理 IndexedDB 中的所有战报图片数据
 *
 * 问题：历史数据中每条战报都包含完整的图片（base64），导致 IndexedDB 占用几个 GB
 * 解决方案：删除所有图片数据，只保留元数据（武将、战法、损失率等），图片改为云端按需加载
 *
 * 效果：缓存占用降低 100-1000 倍（1000条战报从 0.5-2GB 降至 5-20MB）
 *
 * 使用方法：
 * 1. 打开 www.zhenwu.fun
 * 2. 按 F12 打开浏览器控制台
 * 3. 粘贴并运行此脚本
 * 4. 等待清理完成（根据数据量，可能需要几分钟）
 */

async function cleanAllImages() {
  console.log('========== 清理 IndexedDB 图片数据 ==========');
  console.log('⏳ 正在清理，请勿关闭页面...\n');

  try {
    // 1. 打开数据库
    if (!db) {
      console.log('正在打开数据库...');
      await openDB();
    }
    console.log('✅ 数据库已打开');

    // 2. 获取所有记录
    console.log('正在读取所有记录...');
    const allRecords = await dbGetAll();
    console.log(`✅ 共读取 ${allRecords.length} 条记录`);

    // 3. 统计图片数据量
    let recordsWithImage = 0;
    let totalImageSize = 0;
    for (const rec of allRecords) {
      if (rec.imageBase64) {
        recordsWithImage++;
        // 估算图片大小（base64 字符串长度 × 3/4 ≈ 原始字节数）
        totalImageSize += rec.imageBase64.length * 0.75;
      }
    }

    console.log(`\n📊 统计信息：`);
    console.log(`  - 总记录数：${allRecords.length} 条`);
    console.log(`  - 含图片记录：${recordsWithImage} 条`);
    console.log(`  - 图片占用空间：${(totalImageSize / 1024 / 1024).toFixed(2)} MB`);

    if (recordsWithImage === 0) {
      console.log('\n✅ 没有需要清理的图片数据');
      return;
    }

    // 4. 用户确认
    const confirmed = confirm(
      `发现 ${recordsWithImage} 条记录包含图片数据（约 ${(totalImageSize / 1024 / 1024).toFixed(2)} MB）\n\n` +
      `清理后，图片将改为云端按需加载（点击"查看原图"时才加载）\n` +
      `这不会影响数据底表和报表功能。\n\n` +
      `是否继续清理？`
    );

    if (!confirmed) {
      console.log('❌ 用户取消操作');
      return;
    }

    // 5. 清理图片数据
    console.log('\n🔧 开始清理...');
    let cleaned = 0;
    let failed = 0;

    for (let i = 0; i < allRecords.length; i++) {
      const rec = allRecords[i];
      if (!rec.imageBase64) continue;

      try {
        // 删除图片数据，保留元数据
        delete rec.imageBase64;
        delete rec.image_data;
        rec.hasImage = true; // 标记有图，按需从云端加载

        // 写回 IndexedDB
        await dbPutLocal(rec);
        cleaned++;

        // 每 100 条记录显示一次进度
        if (cleaned % 100 === 0) {
          const progress = ((i + 1) / allRecords.length * 100).toFixed(1);
          console.log(`  进度：${progress}% (${cleaned}/${recordsWithImage} 条已清理)`);
        }
      } catch (e) {
        failed++;
        console.warn(`  ⚠️ 清理失败 (ID: ${rec.id}):`, e.message);
      }
    }

    // 6. 完成
    console.log('\n========== 清理完成 ==========');
    console.log(`✅ 成功清理：${cleaned} 条`);
    if (failed > 0) {
      console.log(`⚠️ 清理失败：${failed} 条`);
    }
    console.log(`💾 预计释放空间：${(totalImageSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`\n提示：`);
    console.log(`  - 数据底表和报表功能不受影响`);
    console.log(`  - 点击"查看原图"时会从云端自动加载`);
    console.log(`  - 建议刷新页面（Ctrl+R）以查看效果`);

    // 7. 刷新显示
    if (typeof loadAllRecords === 'function') {
      await loadAllRecords();
      console.log('✅ 已刷新数据显示');
    }

    // 8. 显示当前缓存占用
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      console.log(`\n📊 当前浏览器缓存占用：`);
      console.log(`  - 已使用：${(used / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  - 配额：${(quota / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  - 占用率：${(used / quota * 100).toFixed(1)}%`);
    }

  } catch (e) {
    console.error('❌ 清理失败:', e);
    console.error('详细错误:', e.stack);
  }
}

// 自动运行
console.log('提示：即将开始清理 IndexedDB 中的图片数据...');
console.log('如需取消，请关闭浏览器控制台');
setTimeout(() => {
  cleanAllImages();
}, 1000);

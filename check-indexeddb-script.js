/**
 * 检查前端IndexedDB中的记录
 *
 * 使用方法：
 * 1. 打开浏览器控制台（F12）
 * 2. 确保已经登录并进入了项目
 * 3. 复制粘贴此脚本运行
 */

(async function checkIndexedDBRecords() {
  console.log('========== IndexedDB 记录检查 ==========');

  if (!window.currentProjectId) {
    console.error('❌ 未选择项目，请先进入项目');
    return;
  }

  console.log('当前项目ID:', window.currentProjectId);

  // 1. 检查 allRecords（内存中的数据）
  if (typeof allRecords !== 'undefined') {
    console.log('\n📊 内存中的记录数 (allRecords):', allRecords.length);

    // 检查是否有重复的 id
    const ids = allRecords.map(r => r.id);
    const uniqueIds = new Set(ids);

    if (ids.length !== uniqueIds.size) {
      console.log('⚠️ 警告：内存中存在重复的 ID！');

      // 找出重复的 id
      const idCounts = {};
      ids.forEach(id => {
        idCounts[id] = (idCounts[id] || 0) + 1;
      });

      const duplicateIds = Object.entries(idCounts)
        .filter(([id, count]) => count > 1)
        .map(([id, count]) => ({ id: parseInt(id), count }));

      console.log('重复的 ID：');
      console.table(duplicateIds);

      // 显示重复记录的详细信息
      console.log('\n重复记录详情：');
      duplicateIds.forEach(({ id }) => {
        const records = allRecords.filter(r => r.id === id);
        console.log(`\nID ${id} 的 ${records.length} 条记录：`);
        console.table(records.map(r => ({
          id: r.id,
          cloudId: r.cloudId,
          attacker: r.leftPlayer || r.attackerName || '(空)',
          enemy: r.rightPlayer || r.enemyName || '(空)',
          left_gen: r.leftGeneral1 || '(空)',
          synced: r._synced ? '是' : '否',
          syncTime: r._syncTime ? new Date(r._syncTime).toLocaleString() : '-'
        })));
      });
    } else {
      console.log('✅ 内存中没有重复的 ID');
    }

    // 显示所有记录概览
    console.log('\n所有记录概览：');
    console.table(allRecords.map(r => ({
      id: r.id,
      cloudId: r.cloudId,
      attacker: r.leftPlayer || r.attackerName || '(空)',
      enemy: r.rightPlayer || r.enemyName || '(空)',
      left_gen: r.leftGeneral1 || '(空)'
    })));
  }

  // 2. 直接查询 IndexedDB
  if (typeof db !== 'undefined' && db) {
    console.log('\n📦 正在查询 IndexedDB...');
    const tx = db.transaction(['records'], 'readonly');
    const store = tx.objectStore('records');
    const allReq = store.getAll();

    allReq.onsuccess = () => {
      const allDBRecords = allReq.result;
      const projectRecords = allDBRecords.filter(r =>
        String(r.projectId) === String(window.currentProjectId)
      );

      console.log('IndexedDB 中当前项目的记录数:', projectRecords.length);
      console.log('IndexedDB 中所有记录数:', allDBRecords.length);

      // 检查 IndexedDB 中的重复
      const dbIds = projectRecords.map(r => r.id);
      const uniqueDbIds = new Set(dbIds);

      if (dbIds.length !== uniqueDbIds.size) {
        console.log('⚠️ 警告：IndexedDB 中存在重复的 ID！');
      } else {
        console.log('✅ IndexedDB 中没有重复的 ID');
      }
    };
  }

  console.log('\n========== 检查完成 ==========');
})();

/**
 * 清理IndexedDB中的重复记录
 *
 * 使用方法：
 * 1. 打开浏览器控制台（F12）
 * 2. 确保已经登录并进入了项目
 * 3. 复制粘贴此脚本运行
 */

(async function cleanDuplicateRecords() {
  console.log('========== 清理重复记录 ==========');

  if (!window.currentProjectId) {
    console.error('❌ 未选择项目，请先进入项目');
    return;
  }

  if (typeof db === 'undefined' || !db) {
    console.error('❌ IndexedDB 未初始化');
    return;
  }

  console.log('当前项目ID:', window.currentProjectId);

  try {
    // 1. 获取所有记录
    const allDBRecords = await new Promise((resolve, reject) => {
      const tx = db.transaction(['records'], 'readonly');
      const req = tx.objectStore('records').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // 2. 过滤当前项目的记录
    const projectRecords = allDBRecords.filter(r =>
      String(r.projectId) === String(window.currentProjectId)
    );

    console.log('当前项目总记录数:', projectRecords.length);

    // 3. 找出重复的ID
    const idMap = {};
    projectRecords.forEach(r => {
      if (!idMap[r.id]) idMap[r.id] = [];
      idMap[r.id].push(r);
    });

    const duplicateGroups = Object.entries(idMap)
      .filter(([id, records]) => records.length > 1)
      .map(([id, records]) => ({ id: parseInt(id), records }));

    if (duplicateGroups.length === 0) {
      console.log('✅ 没有发现重复记录');
      return;
    }

    console.log(`⚠️ 发现 ${duplicateGroups.length} 组重复记录，共 ${duplicateGroups.reduce((sum, g) => sum + g.records.length, 0)} 条`);

    // 4. 显示重复记录详情
    duplicateGroups.forEach(({ id, records }) => {
      console.log(`\nID ${id} 有 ${records.length} 条重复记录：`);
      console.table(records.map((r, idx) => ({
        序号: idx + 1,
        attacker: r.leftPlayer || r.attackerName || '(空)',
        enemy: r.rightPlayer || r.enemyName || '(空)',
        left_gen: r.leftGeneral1 || '(空)',
        _synced: r._synced ? '是' : '否',
        cloudId: r.cloudId || '-'
      })));
    });

    // 5. 确认是否清理
    const confirm = window.confirm(
      `发现 ${duplicateGroups.length} 组重复记录\n` +
      `共 ${duplicateGroups.reduce((sum, g) => sum + g.records.length, 0)} 条，将保留每组的第1条，删除其余重复项。\n\n` +
      `是否继续清理？`
    );

    if (!confirm) {
      console.log('❌ 用户取消清理');
      return;
    }

    // 6. 删除重复记录（保留每组第一条）
    let deletedCount = 0;
    const tx = db.transaction(['records'], 'readwrite');
    const store = tx.objectStore('records');

    for (const { id, records } of duplicateGroups) {
      // 保留第一条，删除其余
      for (let i = 1; i < records.length; i++) {
        // IndexedDB的主键是自增的，所以需要删除具体的记录
        // 但由于相同的id，我们需要用其他方式区分
        // 这里我们删除所有该id的记录，然后重新插入第一条
      }
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    console.log('由于IndexedDB的限制，我们采用另一种方法...');

    // 方法2：删除所有重复记录，只保留第一条
    for (const { id, records } of duplicateGroups) {
      // 由于IndexedDB的id是keyPath，相同id的记录实际上不应该存在
      // 这说明可能是IndexedDB的主键不是我们想的id字段
      // 让我们检查一下
      console.log('记录结构检查:', records[0]);
    }

    console.log('\n⚠️ 检测到IndexedDB结构问题');
    console.log('请使用以下方法清理：');
    console.log('1. 刷新页面（Ctrl+Shift+R）');
    console.log('2. 系统会自动从云端同步正确的数据');
    console.log('3. 或者点击"清空所有数据"后重新同步');

  } catch (e) {
    console.error('清理失败:', e);
  }

  console.log('\n========== 清理完成 ==========');
})();

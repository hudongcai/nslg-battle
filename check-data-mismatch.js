const mysql = require('mysql2/promise');

async function checkDataMismatch() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('========================================');
    console.log('    数据一致性检查');
    console.log('========================================\n');

    // 1. OCR任务队列统计
    console.log('【1】OCR任务队列 (ocr_pending_tasks):');
    const [taskStats] = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM ocr_pending_tasks
      GROUP BY status
    `);

    let totalPending = 0, totalDone = 0, totalFailed = 0;
    taskStats.forEach(row => {
      console.log(`   ${row.status}: ${row.count} 条`);
      if (row.status === 'pending') totalPending = row.count;
      else if (row.status === 'done') totalDone = row.count;
      else if (row.status === 'failed') totalFailed = row.count;
    });

    console.log(`\n   待处理: ${totalPending}`);
    console.log(`   已处理: ${totalDone}`);
    console.log(`   失败: ${totalFailed}`);

    // 2. 战报数据底表
    console.log('\n【2】战报数据底表 (battle_records):');
    const [battleTotal] = await pool.query('SELECT COUNT(*) as total FROM battle_records');
    console.log(`   总记录数: ${battleTotal[0].total} 条`);

    // 3. 按helper_task_id分组统计
    console.log('\n【3】按监听任务分组统计:');
    const [helperStats] = await pool.query(`
      SELECT
        helper_task_id,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing
      FROM ocr_pending_tasks
      WHERE helper_task_id IS NOT NULL
      GROUP BY helper_task_id
    `);

    if (helperStats.length > 0) {
      helperStats.forEach(h => {
        console.log(`\n   监听任务ID: ${h.helper_task_id}`);
        console.log(`      总任务数: ${h.total}`);
        console.log(`      待处理: ${h.pending}`);
        console.log(`      已处理: ${h.done}`);
        console.log(`      处理中: ${h.processing}`);
        console.log(`      失败: ${h.failed}`);
      });
    } else {
      console.log('   无监听任务');
    }

    // 4. 检查关联的战报记录
    console.log('\n【4】已完成任务关联的战报:');
    const [linkedBattles] = await pool.query(`
      SELECT COUNT(DISTINCT battle_record_id) as count
      FROM ocr_pending_tasks
      WHERE status = 'done' AND battle_record_id IS NOT NULL
    `);
    console.log(`   关联战报数: ${linkedBattles[0].count} 条`);

    // 5. 检查未关联战报的已完成任务
    const [unlinkedDone] = await pool.query(`
      SELECT COUNT(*) as count
      FROM ocr_pending_tasks
      WHERE status = 'done' AND battle_record_id IS NULL
    `);
    console.log(`   未关联战报的已完成任务: ${unlinkedDone[0].count} 条`);

    // 6. 最近生成的战报
    console.log('\n【5】最近10条战报记录:');
    const [recentBattles] = await pool.query(`
      SELECT id, attacker_name, enemy_name, created_at
      FROM battle_records
      ORDER BY id DESC
      LIMIT 10
    `);

    recentBattles.forEach(b => {
      console.log(`   ID=${b.id}, ${b.attacker_name} vs ${b.enemy_name}, ${b.created_at}`);
    });

    // 7. 检查是否有关联到这些战报的任务
    console.log('\n【6】最新战报与任务的关联:');
    const latestBattleId = recentBattles[0].id;
    const [linkedTasks] = await pool.query(`
      SELECT id, status, image_name, battle_record_id
      FROM ocr_pending_tasks
      WHERE battle_record_id >= ?
      ORDER BY battle_record_id DESC
      LIMIT 10
    `, [latestBattleId - 20]);

    if (linkedTasks.length > 0) {
      linkedTasks.forEach(t => {
        console.log(`   任务${t.id} -> 战报${t.battle_record_id}, 状态=${t.status}, 图片=${t.image_name}`);
      });
    } else {
      console.log('   最近战报没有关联的任务');
    }

    console.log('\n========================================');

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkDataMismatch();

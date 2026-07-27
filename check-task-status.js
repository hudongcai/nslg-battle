const mysql = require('mysql2/promise');

async function checkTaskStatus() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== OCR任务状态统计 ===\n');

    // 按状态分组统计
    const [stats] = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM ocr_pending_tasks
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('各状态任务数量:');
    stats.forEach(row => {
      console.log(`  ${row.status}: ${row.count} 条`);
    });

    // 查看最近完成的任务
    console.log('\n最近处理的任务（非pending状态）:');
    const [recent] = await pool.query(`
      SELECT id, status, image_name, battle_record_id, updated_at
      FROM ocr_pending_tasks
      WHERE status != 'pending'
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    recent.forEach(task => {
      console.log(`  ID=${task.id}, 状态=${task.status}, 图片=${task.image_name}, 战报ID=${task.battle_record_id || 'NULL'}, 更新=${task.updated_at}`);
    });

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkTaskStatus();

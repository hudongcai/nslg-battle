const mysql = require('mysql2/promise');

async function restartQueue() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 重置OCR队列 ===\n');

    // 1. 将所有 processing 状态重置为 pending
    const [result] = await pool.query(
      "UPDATE ocr_pending_tasks SET status = 'pending', updated_at = NOW() WHERE status = 'processing'"
    );
    console.log(`重置 ${result.affectedRows} 个卡住的任务为待处理状态`);

    // 2. 检查当前队列状态
    const [stats] = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM ocr_pending_tasks
      GROUP BY status
    `);

    console.log('\n当前队列状态:');
    stats.forEach(row => {
      console.log(`  ${row.status}: ${row.count} 条`);
    });

    // 3. 显示最早的5个待处理任务
    console.log('\n最早的5个待处理任务:');
    const [pending] = await pool.query(`
      SELECT id, image_name, created_at
      FROM ocr_pending_tasks
      WHERE status = 'pending'
      ORDER BY
        CASE WHEN helper_task_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 5
    `);

    pending.forEach((task, idx) => {
      console.log(`  ${idx + 1}. ID=${task.id}, 图片=${task.image_name}, 创建时间=${task.created_at}`);
    });

    console.log('\n✅ 队列重置完成，后端会自动开始处理');

  } catch (error) {
    console.error('重置失败:', error.message);
  } finally {
    await pool.end();
  }
}

restartQueue();

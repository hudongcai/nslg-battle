const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  connectionLimit: 10
});

async function resetFailedTasks() {
  try {
    console.log('=== 重置失败任务 ===\n');

    // 查询失败任务
    const [tasks] = await pool.query(`
      SELECT id, image_name, error_message
      FROM ocr_pending_tasks
      WHERE status = 'failed'
      ORDER BY id DESC
    `);

    if (tasks.length === 0) {
      console.log('没有需要重置的任务');
      return;
    }

    console.log(`找到 ${tasks.length} 条失败任务:\n`);
    tasks.forEach(t => {
      console.log(`  ID ${t.id}: ${t.image_name} - ${t.error_message || '无错误信息'}`);
    });

    console.log('\n是否要将这些任务重置为 pending 状态？');
    console.log('请手动确认后运行以下 SQL：\n');
    console.log('UPDATE ocr_pending_tasks SET status = "pending", error_message = NULL, updated_at = NOW() WHERE status = "failed";\n');

  } catch (err) {
    console.error('查询失败:', err.message);
  } finally {
    await pool.end();
  }
}

resetFailedTasks();

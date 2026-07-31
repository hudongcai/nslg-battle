const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  connectionLimit: 10
});

async function resetAndMonitor() {
  try {
    console.log('=== 重置失败任务并监控处理 ===\n');

    // 1. 重置失败任务
    console.log('1. 重置失败任务为 pending 状态...');
    const [result] = await pool.query(`
      UPDATE ocr_pending_tasks 
      SET status = 'pending', error_message = NULL, updated_at = NOW() 
      WHERE status = 'failed'
    `);
    console.log(`   ✅ 已重置 ${result.affectedRows} 条任务\n`);

    if (result.affectedRows === 0) {
      console.log('没有需要处理的任务');
      return;
    }

    // 2. 查看待处理任务
    const [pending] = await pool.query(`
      SELECT id, image_name, status
      FROM ocr_pending_tasks
      WHERE status IN ('pending', 'processing')
      ORDER BY id DESC
    `);

    console.log('2. 当前待处理/处理中的任务:');
    pending.forEach(t => {
      console.log(`   ID ${t.id}: ${t.image_name} - ${t.status}`);
    });
    console.log('');

    console.log('3. 队列处理器会自动处理这些任务（每1秒检查一次）');
    console.log('   你可以运行 "监控OCR队列.bat" 观察处理进度\n');

  } catch (err) {
    console.error('操作失败:', err.message);
  } finally {
    await pool.end();
  }
}

resetAndMonitor();

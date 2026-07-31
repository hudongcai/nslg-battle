const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  waitForConnections: true,
  connectionLimit: 10
});

async function monitor() {
  console.log('开始监控OCR队列...\n');
  
  setInterval(async () => {
    try {
      const [stats] = await pool.query(`
        SELECT 
          status,
          COUNT(*) as count,
          MAX(updated_at) as last_update
        FROM ocr_pending_tasks
        GROUP BY status
      `);
      
      const now = new Date().toISOString().substr(11, 8);
      console.log(`[${now}] 队列状态:`);
      
      if (stats.length === 0) {
        console.log('  队列为空');
      } else {
        stats.forEach(s => {
          console.log(`  ${s.status}: ${s.count} 条 (最后更新: ${s.last_update})`);
        });
      }
      console.log('');
      
    } catch (err) {
      console.error('查询失败:', err.message);
    }
  }, 10000);
}

monitor();

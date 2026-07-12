const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  const userId = 1;
  const projectId = 1778470540662;

  console.log('=== 所有待处理任务 ===');
  const [all] = await pool.query(
    'SELECT id, status, image_name, created_at FROM ocr_pending_tasks WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC',
    [userId, projectId]
  );
  console.log('总数:', all.length);
  console.table(all.slice(0, 10));

  console.log('\n=== 按状态统计 ===');
  const [stats] = await pool.query(
    'SELECT status, COUNT(*) as count FROM ocr_pending_tasks WHERE user_id = ? AND project_id = ? GROUP BY status',
    [userId, projectId]
  );
  console.table(stats);

  await pool.end();
})();

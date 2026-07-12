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

  console.log('=== 删除前 ===');
  const [before] = await pool.query('SELECT id, status, image_name FROM ocr_pending_tasks WHERE user_id = ? AND project_id = ?', [userId, projectId]);
  console.table(before);

  console.log('\n=== 执行删除（排除 processing）===');
  const [result] = await pool.query(
    'DELETE FROM ocr_pending_tasks WHERE user_id = ? AND project_id = ? AND status != ?',
    [userId, projectId, 'processing']
  );
  console.log('删除了', result.affectedRows, '条记录');

  console.log('\n=== 删除后 ===');
  const [after] = await pool.query('SELECT id, status, image_name FROM ocr_pending_tasks WHERE user_id = ? AND project_id = ?', [userId, projectId]);
  console.table(after);

  await pool.end();
})();

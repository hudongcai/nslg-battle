const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  const projectId = 1778470540662;

  console.log('=== OCR 待处理队列 ===');
  const [pending] = await pool.query('SELECT COUNT(*) as count FROM ocr_pending_tasks WHERE project_id = ?', [projectId]);
  console.log('待处理任务数:', pending[0].count);

  console.log('\n=== 战报记录 ===');
  const [battles] = await pool.query('SELECT COUNT(*) as count FROM battle_records WHERE project_id = ?', [projectId]);
  console.log('战报记录数:', battles[0].count);

  console.log('\n=== 图片库 ===');
  const [gallery] = await pool.query('SELECT COUNT(*) as count FROM battle_gallery WHERE project_id = ?', [projectId]);
  console.log('图片库数量:', gallery[0].count);

  await pool.end();
})();

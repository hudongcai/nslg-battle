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

  console.log('=== 战报记录数量 ===');
  const [count] = await pool.query(
    'SELECT COUNT(*) as count FROM battle_records WHERE project_id = ?',
    [projectId]
  );
  console.log('战报记录总数:', count[0].count);

  console.log('\n=== 图片库数量 ===');
  const [galleryCount] = await pool.query(
    'SELECT COUNT(*) as count, parse_status, GROUP_CONCAT(DISTINCT parse_status) as statuses FROM battle_gallery WHERE project_id = ? GROUP BY parse_status',
    [projectId]
  );
  console.table(galleryCount);

  await pool.end();
})();

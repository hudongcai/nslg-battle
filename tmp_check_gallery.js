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

  console.log('\n=== 图片库总数 ===');
  const [galleryTotal] = await pool.query(
    'SELECT COUNT(*) as count FROM battle_gallery WHERE project_id = ?',
    [projectId]
  );
  console.log('图片库总数:', galleryTotal[0].count);

  console.log('\n=== 图片库详情（最新20条）===');
  const [gallery] = await pool.query(
    'SELECT id, file_name, battle_id, created_at FROM battle_gallery WHERE project_id = ? ORDER BY created_at DESC LIMIT 20',
    [projectId]
  );
  console.table(gallery);

  await pool.end();
})();

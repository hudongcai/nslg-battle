const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  console.log('=== 查找空结果的记录 ===');
  const [empty] = await pool.query(
    `SELECT id, battle_date, result, attacker_name, enemy_name, left_general_1, left_loss, right_loss, created_at
     FROM battle_records
     WHERE project_id = 1778470540662
       AND (result IS NULL OR result = '' OR result = '-')
     ORDER BY id DESC
     LIMIT 10`
  );
  console.log('空记录数量:', empty.length);
  console.table(empty);

  console.log('\n=== 所有记录统计 ===');
  const [stats] = await pool.query(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN result IS NULL OR result = '' OR result = '-' THEN 1 ELSE 0 END) as empty_count,
       SUM(CASE WHEN result IN ('胜', '败', '平') THEN 1 ELSE 0 END) as valid_count
     FROM battle_records
     WHERE project_id = 1778470540662`
  );
  console.table(stats);

  await pool.end();
})();

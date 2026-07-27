const mysql = require('mysql2/promise');

async function checkSchema() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    // 查看表结构
    const [columns] = await pool.query(
      "SHOW COLUMNS FROM battle_records"
    );

    console.log('=== battle_records 表结构 ===\n');
    columns.forEach(col => {
      console.log(`${col.Field} - ${col.Type} - ${col.Null} - ${col.Key}`);
    });

    // 查看最近3条记录（只查主要字段）
    console.log('\n=== 最近3条记录 ===');
    const [records] = await pool.query(
      `SELECT * FROM battle_records ORDER BY id DESC LIMIT 3`
    );

    records.forEach((rec, idx) => {
      console.log(`\n记录 ${idx + 1}:`);
      console.log(JSON.stringify(rec, null, 2));
    });

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkSchema();

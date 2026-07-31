const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  charset: 'utf8mb4',
  dateStrings: true
};

async function queryTables() {
  const pool = mysql.createPool(dbConfig);

  try {
    // 查询所有表
    const [tables] = await pool.query('SHOW TABLES');
    console.log('数据库所有表:');
    tables.forEach(row => {
      const tableName = Object.values(row)[0];
      console.log(`  - ${tableName}`);
    });

    // 查询 ocr_pending_tasks 总数和状态分布
    const [ocrCount] = await pool.query('SELECT COUNT(*) as count FROM ocr_pending_tasks');
    console.log(`\nocr_pending_tasks 总记录数: ${ocrCount[0].count}`);

    const [ocrStats] = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM ocr_pending_tasks
      GROUP BY status
    `);
    console.log('ocr_pending_tasks 按状态分布:');
    ocrStats.forEach(row => {
      console.log(`  - ${row.status}: ${row.count}`);
    });

    // 查询 battle_records 表相关统计
    const [battleRecordsTotal] = await pool.query('SELECT COUNT(*) as count FROM battle_records');
    console.log(`\nbattle_records 总记录数: ${battleRecordsTotal[0].count}`);

    // 查询 battle_records 表结构
    const [battleRecordsColumns] = await pool.query('DESCRIBE battle_records');
    console.log('\nbattle_records 表结构:');
    battleRecordsColumns.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type})`);
    });

    // 查询 battle_gallery 表相关统计
    const [battleGalleryTotal] = await pool.query('SELECT COUNT(*) as count FROM battle_gallery');
    console.log(`\nbattle_gallery 总记录数: ${battleGalleryTotal[0].count}`);

  } catch (err) {
    console.error('查询失败:', err);
  } finally {
    await pool.end();
  }
}

queryTables();

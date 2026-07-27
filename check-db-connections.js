const mysql = require('mysql2/promise');

async function checkDbConnections() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== MySQL连接诊断 ===\n');

    // 1. 查看当前进程列表
    const [processes] = await pool.query('SHOW PROCESSLIST');

    console.log('当前MySQL连接:');
    processes.forEach(p => {
      if (p.db === 'nslg_battle' || p.User === 'nslg-battle-server') {
        console.log(`  ID=${p.Id}, User=${p.User}, State=${p.State || 'idle'}, Time=${p.Time}s, Info=${(p.Info || '').substring(0, 50)}`);
      }
    });

    // 2. 检查是否有锁等待
    console.log('\n检查锁等待:');
    try {
      const [locks] = await pool.query(`
        SELECT * FROM information_schema.INNODB_LOCKS
      `);
      if (locks.length > 0) {
        console.log('  发现锁:', locks.length);
      } else {
        console.log('  无锁');
      }
    } catch (e) {
      console.log('  无法查询（可能是权限问题）');
    }

    // 3. 检查长时间运行的事务
    console.log('\n长时间运行的事务:');
    try {
      const [trx] = await pool.query(`
        SELECT trx_id, trx_state, trx_started, trx_mysql_thread_id
        FROM information_schema.INNODB_TRX
        WHERE TIMESTAMPDIFF(SECOND, trx_started, NOW()) > 10
      `);
      if (trx.length > 0) {
        trx.forEach(t => {
          console.log(`  事务${t.trx_id}: ${t.trx_state}, 已运行${Math.floor((Date.now() - new Date(t.trx_started)) / 1000)}秒`);
        });
      } else {
        console.log('  无');
      }
    } catch (e) {
      console.log('  无法查询');
    }

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkDbConnections();

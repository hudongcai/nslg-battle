const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle'
  });

  try {
    const [users] = await pool.query('SELECT id, phone, status FROM users LIMIT 5');
    console.log('=== 用户列表 ===');
    users.forEach(u => console.log(`ID: ${u.id}, Phone: ${u.phone}, Status: ${u.status}`));

    if (users.length > 0) {
      const phone = users[0].phone;
      const timestamp = Date.now();
      const token = `mock-token-${phone}-${timestamp}`;
      console.log(`\n测试Token: ${token}`);
    }
  } catch (err) {
    console.error('错误:', err.message);
  } finally {
    await pool.end();
  }
})();

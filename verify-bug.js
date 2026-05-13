const mysql = require('mysql2/promise');
const dbConfig = {
  host: 'localhost', port: 3306,
  user: 'nslg-battle-server', password: 'hu6956521', database: 'nslg_battle'
};

async function verify() {
  const pool = await mysql.createPool(dbConfig);

  // 先记录重置前的状态
  const [before] = await pool.query('SELECT id, phone, password FROM users ORDER BY id');
  console.log('重置前密码:');
  before.forEach(u => console.log(`  ID:${u.id} ${u.phone} => ${u.password}`));

  // 只重置用户 36（13522222222）的密码为 111111
  console.log('\n执行: UPDATE users SET password = "111111" WHERE id = 36');
  const [result] = await pool.query('UPDATE users SET password = ? WHERE id = ?', ['111111', 36]);
  console.log('受影响行数:', result.affectedRows);

  // 查看重置后的状态
  const [after] = await pool.query('SELECT id, phone, password FROM users ORDER BY id');
  console.log('\n重置后密码:');
  after.forEach(u => console.log(`  ID:${u.id} ${u.phone} => ${u.password}`));

  // 哪些用户密码是 111111
  const affected = after.filter(u => u.password === '111111');
  console.log(`\n密码为 111111 的用户: ${affected.length} 个`);
  affected.forEach(u => console.log(`  ID:${u.id} ${u.phone}`));

  await pool.end();
}
verify();

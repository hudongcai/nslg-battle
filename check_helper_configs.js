const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    dateStrings: true
  });

  try {
    // 检查 helper_configs 表
    const [configs] = await pool.query(`
      SELECT id, user_id, project_id, helper_client_id, device_id,
             folder_path, folder_status, folder_status_message,
             access_token, token_expires_at, created_at, updated_at
      FROM helper_configs
      WHERE user_id = 1 AND project_id = 1778470540662
      LIMIT 1
    `);

    console.log('=== helper_configs 表 ===');
    console.log(JSON.stringify(configs, null, 2));

  } catch (err) {
    console.error('查询失败:', err);
  } finally {
    await pool.end();
  }
})();

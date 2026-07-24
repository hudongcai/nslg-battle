const mysql = require('mysql2/promise');

async function checkHelperTasks() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'hu6956521',
    database: 'nslg_battle',
    waitForConnections: true,
    connectionLimit: 10
  });

  try {
    // 查询所有 helper_configs
    const [configs] = await pool.query(
      'SELECT id, user_id, project_id, folder_path, helper_client_id FROM helper_configs ORDER BY id'
    );

    console.log('=== Helper Tasks 配置 ===');
    for (const config of configs) {
      console.log(`Task ID: ${config.id}, User: ${config.user_id}, Project: ${config.project_id}, ClientID: ${config.helper_client_id}`);
      console.log(`  Path: ${config.folder_path}`);
    }

    // 查询 helper_clients
    const [clients] = await pool.query(
      'SELECT id, user_id, token FROM helper_clients ORDER BY id'
    );

    console.log('\n=== Helper Clients ===');
    for (const client of clients) {
      console.log(`Client ID: ${client.id}, User: ${client.user_id}, Token: ${client.token.substring(0, 30)}...`);
    }

  } finally {
    await pool.end();
  }
}

checkHelperTasks().catch(console.error);

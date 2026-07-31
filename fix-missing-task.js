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
    const userId = 1;
    const projectId = 1778470540662;

    console.log('=== 诊断开始 ===');
    console.log(`用户ID: ${userId}`);
    console.log(`项目ID: ${projectId}`);
    console.log('');

    // 1. 检查是否已有任务
    const [existing] = await pool.query(
      'SELECT id, user_id, project_id, helper_client_id, device_id, created_at FROM helper_configs WHERE user_id = ? AND project_id = ?',
      [userId, projectId]
    );

    if (existing.length > 0) {
      console.log('✅ 任务已存在:');
      console.log(JSON.stringify(existing[0], null, 2));
      console.log('');
      console.log('⚠️ 如果前端仍然显示"无任务"，可能是内存状态未同步');
      console.log('建议：重启后端服务 (node nslg-backend.js)');
    } else {
      console.log('❌ 任务不存在，开始创建...');
      console.log('');

      // 2. 检查用户是否已有 token
      const [tokenCheck] = await pool.query(
        'SELECT access_token FROM helper_configs WHERE user_id = ? LIMIT 1',
        [userId]
      );

      let helperToken = '';
      if (tokenCheck.length > 0 && tokenCheck[0].access_token) {
        helperToken = tokenCheck[0].access_token;
        console.log('✅ 复用已有 token');
      } else {
        // 生成新 token
        const crypto = require('crypto');
        helperToken = 'helper-auth-' + crypto.randomBytes(16).toString('hex');
        console.log('✅ 生成新 token');
      }

      // 3. 创建任务
      const [result] = await pool.query(
        'INSERT INTO helper_configs (user_id, project_id, helper_client_id, device_id, access_token, token_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NOW(), NOW())',
        [userId, projectId, userId, 'device-1785509634486', helperToken]
      );

      console.log('✅ 任务已创建:');
      console.log(`  任务ID: ${result.insertId}`);
      console.log(`  用户ID: ${userId}`);
      console.log(`  项目ID: ${projectId}`);
      console.log(`  设备ID: device-1785509634486`);
      console.log(`  Token: ${helperToken}`);
      console.log('');
      console.log('⚠️ 本地助手配置文件中的 taskId 可能不匹配');
      console.log(`  - 本地助手配置显示: taskId=6`);
      console.log(`  - 新创建的任务ID: ${result.insertId}`);
      console.log('');
      console.log('📋 需要执行的操作:');
      console.log('  1. 重启后端服务以加载新任务到内存');
      console.log('  2. 刷新前端页面 (Ctrl+F5)');
      console.log('  3. 重新选择文件夹并保存配置');
      console.log('  4. 点击"开始监听"');
    }

  } catch (err) {
    console.error('❌ 操作失败:', err.message);
  } finally {
    await pool.end();
  }
})();

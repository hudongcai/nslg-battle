const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle'
  });

  try {
    console.log('=== 助手配置和心跳状态 ===\n');

    // 查询助手配置
    const [configs] = await pool.query(`
      SELECT
        id,
        user_id,
        project_id,
        folder_path,
        helper_client_id,
        folder_status,
        created_at,
        updated_at
      FROM helper_configs
      ORDER BY id
    `);

    if (configs.length === 0) {
      console.log('没有找到助手配置记录');
      return;
    }

    console.log(`找到 ${configs.length} 个助手配置:\n`);
    configs.forEach(c => {
      console.log(`任务ID: ${c.id}`);
      console.log(`  用户ID: ${c.user_id}`);
      console.log(`  项目ID: ${c.project_id}`);
      console.log(`  监听目录: ${c.folder_path || '未设置'}`);
      console.log(`  助手设备ID: ${c.helper_client_id || '未绑定'}`);
      console.log(`  目录状态: ${c.folder_status || 'unknown'}`);
      console.log(`  创建时间: ${c.created_at}`);
      console.log(`  更新时间: ${c.updated_at}`);
      console.log('');
    });

    console.log('\n=== 测试说明 ===');
    console.log('1. 在网页端启动监听任务');
    console.log('2. 等待5秒后再次运行此脚本');
    console.log('3. 观察心跳更新情况（通过 WebSocket 推送，数据库不存储心跳时间）');
    console.log('\n注意：lastHeartbeat 存储在后端内存中，不在数据库中');
    console.log('     可以通过浏览器控制台查看 WebSocket 消息来验证心跳');

  } catch (err) {
    console.error('错误:', err.message);
  } finally {
    await pool.end();
  }
})();

/**
 * 测试本地助手连接码验证
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  dateStrings: true
};

async function testToken(token) {
  const pool = mysql.createPool(dbConfig);

  try {
    console.log('测试 token:', token.substring(0, 30) + '...');
    console.log('');

    // 查询数据库验证
    const [rows] = await pool.query(
      `SELECT c.id, c.user_id, c.access_token, u.phone, u.status, c.token_expires_at
       FROM helper_configs c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.access_token = ? AND (c.token_expires_at IS NULL OR c.token_expires_at > NOW())
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      console.log('❌ Token 在数据库中不存在或已过期');

      // 查找相似的 token
      const [similar] = await pool.query(
        `SELECT access_token FROM helper_configs
         WHERE access_token LIKE ? LIMIT 5`,
        [token.substring(0, 20) + '%']
      );

      if (similar.length > 0) {
        console.log('\n数据库中找到相似的 token:');
        similar.forEach(s => {
          console.log('  ', s.access_token.substring(0, 50) + '...');
        });
      }
    } else {
      const row = rows[0];
      console.log('✅ Token 验证通过');
      console.log('  用户ID:', row.user_id);
      console.log('  手机号:', row.phone);
      console.log('  状态:', row.status === 1 ? '正常' : '已禁用');
      console.log('  过期时间:', row.token_expires_at || 'NULL (永久有效)');

      if (row.status !== 1) {
        console.log('\n❌ 但是用户账号已被禁用');
      }
    }

    // 测试 API 调用
    console.log('\n测试 API 调用: /api/ocr-watch/tasks');
    const http = require('http');

    const apiTest = await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/ocr-watch/tasks',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ status: res.statusCode, data });
          } catch (e) {
            resolve({ status: res.statusCode, data: { message: body } });
          }
        });
      });
      req.on('error', (e) => {
        resolve({ status: 0, data: { message: e.message } });
      });
      req.end();
    });

    console.log('  HTTP 状态:', apiTest.status);
    console.log('  响应 code:', apiTest.data.code);
    console.log('  响应 message:', apiTest.data.message || '(无)');

    if (apiTest.status === 200 && apiTest.data.code === 200) {
      console.log('  ✅ API 调用成功');
    } else {
      console.log('  ❌ API 调用失败');
    }

  } catch (e) {
    console.error('测试失败:', e.message);
  } finally {
    await pool.end();
  }
}

// 从命令行参数获取 token，或使用数据库中最新的
(async () => {
  let token = process.argv[2];

  if (!token) {
    const pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query(
      'SELECT access_token FROM helper_configs ORDER BY created_at DESC LIMIT 1'
    );
    await pool.end();

    if (rows.length === 0) {
      console.error('错误: 数据库中没有任何 token，请先在网页端生成连接码');
      process.exit(1);
    }

    token = rows[0].access_token;
    console.log('使用数据库中最新的 token 进行测试\n');
  }

  await testToken(token);
})();

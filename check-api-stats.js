const https = require('http');

async function checkApiStats() {
  console.log('=== 检查后端API统计数据 ===\n');

  // 假设监听任务ID是4
  const helperTaskId = 4;

  // 检查OCR任务统计API
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: `/api/battles/ocr-watch-tasks/${helperTaskId}/stats`,
    method: 'GET',
    headers: {
      'Authorization': 'Bearer mock-token-13800000000-1234567890'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('API响应:');
          console.log(JSON.stringify(json, null, 2));

          if (json.code === 200 && json.data) {
            const stats = json.data;
            console.log('\n解析后的统计:');
            console.log(`  待处理: ${stats.pending || 0}`);
            console.log(`  已处理: ${stats.processed || 0}`);
            console.log(`  失败: ${stats.failed || 0}`);
          }

          resolve();
        } catch (e) {
          console.error('解析响应失败:', e.message);
          console.log('原始响应:', data);
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error('请求失败:', e.message);
      reject(e);
    });

    req.end();
  });
}

checkApiStats().catch(err => {
  console.error('执行失败:', err.message);
  process.exit(1);
});

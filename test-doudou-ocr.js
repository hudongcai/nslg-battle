const http = require('http');

// 测试豆豆识别
async function testDoudouOCR() {
  console.log('=== 测试豆豆识别功能 ===\n');
  
  // 1. 先获取OCR方案列表
  const options1 = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/ocr-schemes',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer mock-token-13800000000-1234567890'
    }
  };
  
  return new Promise((resolve, reject) => {
    const req1 = http.request(options1, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('1. OCR方案列表:', data);
        const result = JSON.parse(data);
        
        if (result.code === 200 && result.data && result.data.length > 0) {
          const schemeName = result.data[0].name;
          console.log(`\n2. 获取方案"${schemeName}"详细信息...\n`);
          
          // 2. 获取方案详细信息
          const options2 = {
            hostname: 'localhost',
            port: 3000,
            path: `/api/ocr-schemes/${encodeURIComponent(schemeName)}`,
            method: 'GET',
            headers: {
              'Authorization': 'Bearer mock-token-13800000000-1234567890'
            }
          };
          
          const req2 = http.request(options2, (res2) => {
            let data2 = '';
            res2.on('data', chunk => data2 += chunk);
            res2.on('end', () => {
              const schemeResult = JSON.parse(data2);
              if (schemeResult.code === 200) {
                const boxes = schemeResult.data.boxes;
                console.log('方案名称:', schemeName);
                console.log('图片尺寸:', schemeResult.data.imageWidth, 'x', schemeResult.data.imageHeight);
                console.log('识别框数量:', boxes.length);
                console.log('\n前15个框（包含豆豆区域）:');
                boxes.slice(0, 15).forEach((box, idx) => {
                  console.log(`  [${idx}] rx1:${box.rx1.toFixed(3)} ry1:${box.ry1.toFixed(3)} rx2:${box.rx2.toFixed(3)} ry2:${box.ry2.toFixed(3)}`);
                });
              }
              resolve();
            });
          });
          req2.on('error', reject);
          req2.end();
        } else {
          console.log('未找到OCR方案');
          resolve();
        }
      });
    });
    req1.on('error', reject);
    req1.end();
  });
}

testDoudouOCR().catch(console.error);

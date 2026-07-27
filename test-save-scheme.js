const http = require('http');

const data = JSON.stringify({
  name: '测试方案ABC',
  imageWidth: 1920,
  imageHeight: 1080,
  boxes: [{ rx1: 0.1, ry1: 0.1, rx2: 0.3, ry2: 0.2 }],
  testAllianceSlots: [],
  testPlayerNames: []
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/ocr-schemes',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Authorization': 'Bearer mock-token-13651810449-' + Date.now(),
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('响应:', body);
  });
});

req.on('error', (e) => {
  console.error('请求失败:', e.message);
});

req.write(data);
req.end();

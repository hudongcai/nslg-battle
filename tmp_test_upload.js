const fs = require('fs');

(async () => {
  const filePath = 'C:\\nslg-battle\\screenshots\\5\\test_new_2.png';
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');

  console.log('文件大小:', (buffer.length / 1024).toFixed(2), 'KB');
  console.log('Base64长度:', base64.length);
  console.log('开始上传...');

  try {
    const resp = await fetch('http://localhost:3000/api/battles/ocr-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-token-13651810449-1783340458148'
      },
      body: JSON.stringify({
        image: base64,
        projectId: 1778470540662,
        imageName: 'test_new_2.png',
        helperTaskId: 12
      })
    });

    const data = await resp.json();
    console.log('响应状态:', resp.status);
    console.log('响应数据:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('上传失败:', e.message);
  }
})();

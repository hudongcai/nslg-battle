const fs = require('fs');

const files = ['test_new_3.png', 'test_new_4.png', 'test_new_5.png'];

(async () => {
  for (const fileName of files) {
    const filePath = `C:\\nslg-battle\\screenshots\\5\\${fileName}`;

    if (!fs.existsSync(filePath)) {
      console.log(`跳过: ${fileName} (文件不存在)`);
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    console.log(`上传 ${fileName} (${(buffer.length / 1024).toFixed(2)} KB)...`);

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
          imageName: fileName,
          helperTaskId: 12
        })
      });

      const data = await resp.json();
      if (data.code === 200) {
        console.log(`✓ ${fileName} 上传成功 (taskId: ${data.data.taskId})`);
      } else {
        console.log(`✗ ${fileName} 上传失败: ${data.message}`);
      }
    } catch (e) {
      console.error(`✗ ${fileName} 上传失败:`, e.message);
    }
  }

  console.log('\n上传完成！');
})();

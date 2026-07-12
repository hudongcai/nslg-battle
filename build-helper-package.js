const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const OUTPUT_DIR = path.join(__dirname, 'dist');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'local-helper.zip');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 删除旧的压缩包
if (fs.existsSync(OUTPUT_FILE)) {
  fs.unlinkSync(OUTPUT_FILE);
}

// 创建压缩包
const output = fs.createWriteStream(OUTPUT_FILE);
const archive = archiver('zip', {
  zlib: { level: 9 }
});

output.on('close', function() {
  console.log('✅ 打包完成！');
  console.log('📦 文件大小:', (archive.pointer() / 1024).toFixed(2), 'KB');
  console.log('📁 输出路径:', OUTPUT_FILE);
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);

// 添加文件
console.log('📦 正在打包本地助手...');
archive.file('local-helper.minimal.js', { name: 'local-helper.minimal.js' });
archive.file('启动助手.bat', { name: '启动助手.bat' });
archive.file('LOCAL_HELPER_README.md', { name: 'README.md' });

// 添加 package.json（如果需要）
const packageJson = {
  "name": "nslg-battle-local-helper",
  "version": "2.1.0",
  "description": "三谋战报系统本地助手",
  "main": "local-helper.minimal.js",
  "dependencies": {
    "mysql2": "^3.6.0"
  }
};
archive.append(JSON.stringify(packageJson, null, 2), { name: 'package.json' });

archive.finalize();

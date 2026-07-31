/**
 * 本地助手 v4.0 - 纯本地文件夹监听
 *
 * 设计原则：
 * 1. 文件夹路径是纯本地的事情，与后端无关
 * 2. 前端选择文件夹 → 本地助手立即监听
 * 3. 后端只负责接收上传的图片，不存储路径
 * 4. 配置简化为：{ folderPath, projectId }
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ========== 配置 ==========
const CONFIG_PATH = path.join(__dirname, 'local-helper.config.json');
const PID_PATH = path.join(__dirname, 'local-helper.pid');
const DEFAULT_API_BASE = 'https://api.zhenwu.fun/api';
const POLL_INTERVAL = 5;  // 轮询间隔（秒）
const HELPER_PORT = 9999;  // HTTP 服务端口

let httpServer = null;

// ========== 工具函数 ==========

function readJson(fp, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(fp, value) {
  fs.writeFileSync(fp, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeApiBase(apiBase) {
  const value = String(apiBase || DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
  if (/^http:\/\/api\.zhenwu\.fun\/api\/?$/i.test(value)) {
    return 'https://api.zhenwu.fun/api';
  }
  return value.replace(/\/$/, '');
}

function removeFileQuietly(fp) {
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {}
}

// ========== 单实例锁 ==========

function acquireSingleInstanceLock() {
  const existing = readJson(PID_PATH, null);
  if (existing && isProcessRunning(Number(existing.pid))) {
    console.log('✅ 本地助手已在运行');
    process.exit(0);
  }

  writeJson(PID_PATH, { pid: process.pid, startedAt: new Date().toISOString() });
  const cleanup = () => removeFileQuietly(PID_PATH);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function isProcessRunning(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// ========== 扫描本地文件 ==========

function listImages(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) {
      return [];
    }
    return fs.readdirSync(folderPath)
      .filter(name => /\.(png|jpg|jpeg)$/i.test(name))
      .sort();
  } catch (e) {
    return [];
  }
}

// ========== 查询已处理文件（去重） ==========

async function getProcessedFiles(config, projectId) {
  try {
    const url = normalizeApiBase(config.apiBase) +
      `/gallery/imagenames?successOnly=true&projectId=${encodeURIComponent(projectId || 0)}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + config.helperToken }
    });

    const data = await resp.json();
    if (!resp.ok || data.code >= 400) {
      throw new Error(data.message || ('HTTP ' + resp.status));
    }

    return new Set(Array.isArray(data.data) ? data.data : []);
  } catch (e) {
    console.warn('[去重查询] 获取已处理文件失败:', e.message);
    throw e;  // 查询失败时抛出异常，避免重复上传
  }
}

// ========== 上传文件 ==========

async function uploadFile(config, projectId, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');

  // 获取项目标注配置
  let labelConfig = null;
  try {
    const configResp = await fetch(
      normalizeApiBase(config.apiBase) + `/label-config/${projectId || 0}`,
      { headers: { 'Authorization': 'Bearer ' + config.helperToken } }
    );
    if (configResp.ok) {
      const configData = await configResp.json();
      if (configData.code === 200 && configData.data && configData.data.categories) {
        labelConfig = configData.data.categories;
      }
    }
  } catch (e) {
    console.warn('[标注配置] 获取失败，使用自动检测模式:', e.message);
  }

  // 上传文件
  const reqBody = {
    image: base64,
    projectId: projectId || null,
    imageName: fileName,
    source: 'auto-watch'
  };
  if (labelConfig) {
    reqBody.labelConfig = labelConfig;
  }

  const resp = await fetch(
    normalizeApiBase(config.apiBase) + '/battles/ocr-tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.helperToken
      },
      body: JSON.stringify(reqBody)
    }
  );

  const data = await resp.json();
  if (!resp.ok || data.code !== 200) {
    const err = new Error(data.message || ('Upload failed: HTTP ' + resp.status));
    err.code = data.code || resp.status;
    throw err;
  }

  return data.data || null;
}

// ========== 核心：监听文件夹并上传 ==========

async function watchAndUpload(config) {
  const folderPath = config.folderPath;
  const projectId = config.projectId || 0;

  // 检查文件夹路径是否配置
  if (!folderPath || !folderPath.trim()) {
    return;
  }

  // 检查文件夹是否存在
  if (!fs.existsSync(folderPath)) {
    // 避免重复打印相同的错误
    if (!config._lastFolderError || config._lastFolderError !== folderPath) {
      console.warn(`⚠️  文件夹不存在: ${folderPath}`);
      config._lastFolderError = folderPath;
    }
    return;
  }

  // 文件夹存在，清除错误标记
  if (config._lastFolderError === folderPath) {
    console.log(`✅ 文件夹已恢复: ${folderPath}`);
    delete config._lastFolderError;
  }

  // 查询已处理文件（去重）
  let processedFiles;
  try {
    processedFiles = await getProcessedFiles(config, projectId);
  } catch (e) {
    console.warn(`[监听] 查询已处理文件失败，跳过本轮，避免重复上传`);
    return;
  }

  // 扫描本地文件
  const localFiles = listImages(folderPath);

  // 计算新文件
  const newFiles = localFiles.filter(name => !processedFiles.has(name));

  if (newFiles.length === 0) {
    return;  // 无新文件，直接返回
  }

  console.log(`[监听] 发现 ${newFiles.length} 个新文件`);

  // 逐个上传
  for (let i = 0; i < newFiles.length; i++) {
    const fileName = newFiles[i];
    const fullPath = path.join(folderPath, fileName);

    // 检查文件大小
    try {
      const stats = fs.statSync(fullPath);
      if (stats.size > 5 * 1024 * 1024) {
        console.warn(`[监听] 文件过大，跳过: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        continue;
      }
    } catch (e) {
      console.warn(`[监听] 读取文件失败: ${fileName} - ${e.message}`);
      continue;
    }

    // 上传文件
    try {
      await uploadFile(config, projectId, fullPath, fileName);
      console.log(`[监听] ✅ ${fileName}`);
    } catch (e) {
      console.error(`[监听] ❌ ${fileName}: ${e.message}`);
    }
  }
}

// ========== HTTP 服务器 ==========

function startHttpServer(config) {
  if (httpServer) return;

  httpServer = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // /ping 和 /status - 检测助手状态
    if ((req.url === '/ping' || req.url === '/status') && req.method === 'GET') {
      const currentConfig = readJson(CONFIG_PATH, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: '4.0-local-only',
        configured: !!currentConfig.helperToken,
        helperClientId: currentConfig.helperClientId || null,
        deviceId: currentConfig.deviceId || null,
        apiBase: normalizeApiBase(currentConfig.apiBase),
        folderPath: currentConfig.folderPath || '',
        projectId: currentConfig.projectId || 0,
        folderExists: currentConfig.folderPath ? fs.existsSync(currentConfig.folderPath) : null,
        running: true
      }));
      return;
    }

    // /activate - 激活助手
    if (req.url === '/activate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.token || !data.apiBase) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '缺少必要参数' }));
            return;
          }

          const apiBase = data.apiBase;
          const deviceId = config.deviceId || data.deviceId || ('device-' + Date.now());

          const helperConfigResp = await fetch(
            apiBase.replace(/\/$/, '') + '/ocr-watch/helper-config?deviceId=' + encodeURIComponent(deviceId),
            { headers: { 'Authorization': 'Bearer ' + data.token } }
          );

          const helperConfig = await helperConfigResp.json();
          if (!helperConfigResp.ok || helperConfig.code !== 200 || !helperConfig.data || !helperConfig.data.helperToken) {
            throw new Error(helperConfig.message || 'helper config failed');
          }

          // 保存配置
          config.helperToken = helperConfig.data.helperToken;
          config.helperClientId = helperConfig.data.helperClientId || null;
          config.apiBase = normalizeApiBase(helperConfig.data.apiBase || apiBase);
          config.deviceId = helperConfig.data.deviceId || deviceId;
          writeJson(CONFIG_PATH, config);

          console.log('✅ 助手已激活');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            message: '激活成功',
            helperClientId: config.helperClientId || null,
            deviceId: config.deviceId || ''
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // /set-folder - 设置要监听的文件夹（新接口，替代 bind-task）
    if (req.url === '/set-folder' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.folderPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: '缺少 folderPath' }));
            return;
          }

          // 立即更新配置
          config.folderPath = data.folderPath;
          config.projectId = data.projectId || 0;
          writeJson(CONFIG_PATH, config);

          console.log(`✅ 已设置监听文件夹: ${data.folderPath}`);
          console.log(`   项目ID: ${config.projectId}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 200,
            message: '设置成功',
            folderPath: config.folderPath,
            projectId: config.projectId
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 500, message: e.message }));
        }
      });
      return;
    }

    // /select-folder - 文件夹选择
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    if (reqUrl.pathname === '/select-folder' && req.method === 'GET') {
      const { execSync } = require('child_process');
      const os = require('os');

      const exePath = path.join(__dirname, 'fpicker.exe');
      const ps1Path = path.join(__dirname, 'fpicker.ps1');
      const resultPath = path.join(os.tmpdir(), 'nslg_folder_result.txt');

      const useExe = fs.existsSync(exePath);
      const usePs1 = fs.existsSync(ps1Path);

      if (!useExe && !usePs1) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, data: { path: null }, message: 'fpicker.exe 或 fpicker.ps1 未找到' }));
        return;
      }

      try {
        if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);

        const initialPath = String(reqUrl.searchParams.get('initialPath') || config.folderPath || '').trim();
        const safeInitialPath = initialPath && fs.existsSync(initialPath) ? initialPath.replace(/"/g, '') : '';

        let cmd;
        if (useExe) {
          let cmdArgs = `"${exePath}" "${resultPath}"`;
          if (safeInitialPath) cmdArgs += ` "${safeInitialPath}"`;
          cmd = `cmd /c start "FolderPicker" /min /wait ${cmdArgs}`;
        } else {
          const ps1Args = `-ResultPath "${resultPath}"` + (safeInitialPath ? ` -InitialPath "${safeInitialPath}"` : '');
          cmd = `powershell -STA -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" ${ps1Args}`;
        }

        execSync(cmd, { timeout: 120000 });

        let folderPath = null;
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, 'utf8').trim();
          if (raw && raw !== 'CANCELLED' && !raw.startsWith('ERROR:')) {
            folderPath = raw;
          }
          fs.unlinkSync(resultPath);
        }

        if (folderPath) {
          config.folderPath = folderPath;
          writeJson(CONFIG_PATH, config);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: { path: folderPath } }));
      } catch (e) {
        if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, data: { path: null }, message: e.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  httpServer.listen(HELPER_PORT, '127.0.0.1', () => {
    console.log(`🌐 HTTP 服务: http://127.0.0.1:${HELPER_PORT}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  端口 ${HELPER_PORT} 已被占用`);
      httpServer = null;
    } else {
      console.error('HTTP 服务器错误:', err);
    }
  });
}

// ========== 主循环 ==========

async function main() {
  acquireSingleInstanceLock();

  // 读取配置
  let config = readJson(CONFIG_PATH, null);
  if (!config) {
    console.log('⚠️  未找到配置文件，使用默认配置');
    config = {
      apiBase: DEFAULT_API_BASE,
      helperToken: null,
      folderPath: '',
      projectId: 0
    };
  }

  // 启动 HTTP 服务
  startHttpServer(config);

  console.log('🚀 本地助手已启动 v4.0-local-only');
  console.log(`   API: ${config.apiBase || DEFAULT_API_BASE}`);
  console.log(`   配置: ${config.helperToken ? '已配置' : '未配置'}`);
  console.log(`   监听: ${config.folderPath || '未设置'}`);

  // 主循环：监听文件夹 + 上传文件
  while (true) {
    try {
      // 重新读取配置（支持热更新）
      config = readJson(CONFIG_PATH, config);

      // 如果没有 Token，跳过
      if (!config.helperToken) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
        continue;
      }

      // 监听文件夹并上传新文件
      await watchAndUpload(config);

    } catch (e) {
      console.error('❌ 监听失败:', e.message);
    }

    // 等待下一轮
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
  }
}

main().catch(err => {
  console.error('💥 致命错误:', err);
  process.exit(1);
});

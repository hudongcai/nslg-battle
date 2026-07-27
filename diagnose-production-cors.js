const https = require('https');

async function checkProductionAPI() {
  console.log('=== Production API Diagnosis ===\n');

  const endpoints = [
    'https://api.zhenwu.fun/api/projects?phone=13651810449',
    'https://api.zhenwu.fun/api/label-config/0',
    'https://api.zhenwu.fun/api/ocr-preview/cache-image',
  ];

  for (const url of endpoints) {
    console.log(`Testing: ${url}`);

    // Test OPTIONS request (CORS preflight)
    await new Promise((resolve) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://www.zhenwu.fun',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization'
        }
      };

      const req = https.request(options, (res) => {
        console.log(`  OPTIONS status: ${res.statusCode}`);
        console.log(`  Access-Control-Allow-Origin: ${res.headers['access-control-allow-origin'] || 'NOT SET'}`);
        console.log(`  Access-Control-Allow-Methods: ${res.headers['access-control-allow-methods'] || 'NOT SET'}`);
        console.log(`  Access-Control-Allow-Headers: ${res.headers['access-control-allow-headers'] || 'NOT SET'}`);
        resolve();
      });

      req.on('error', (err) => {
        console.log(`  ERROR: ${err.message}`);
        resolve();
      });

      req.setTimeout(5000, () => {
        console.log(`  ERROR: Timeout`);
        req.destroy();
        resolve();
      });

      req.end();
    });

    console.log('');
  }

  console.log('=== Possible Issues ===');
  console.log('1. Backend server (api.zhenwu.fun) is not running');
  console.log('2. Reverse proxy (Nginx/Cloudflare) not configured for CORS');
  console.log('3. SSL certificate issue');
  console.log('4. Firewall blocking OPTIONS requests');
  console.log('');
  console.log('=== Solution ===');
  console.log('Check Nginx/reverse proxy configuration:');
  console.log('');
  console.log('location /api {');
  console.log('    # Handle OPTIONS preflight');
  console.log('    if ($request_method = OPTIONS) {');
  console.log('        add_header Access-Control-Allow-Origin $http_origin always;');
  console.log('        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;');
  console.log('        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;');
  console.log('        add_header Access-Control-Max-Age 86400 always;');
  console.log('        return 204;');
  console.log('    }');
  console.log('');
  console.log('    # Proxy to backend');
  console.log('    proxy_pass http://localhost:3000;');
  console.log('    proxy_set_header Host $host;');
  console.log('    proxy_set_header X-Real-IP $remote_addr;');
  console.log('');
  console.log('    # CORS headers for actual requests');
  console.log('    add_header Access-Control-Allow-Origin $http_origin always;');
  console.log('    add_header Access-Control-Allow-Credentials true always;');
  console.log('}');
}

checkProductionAPI();

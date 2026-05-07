const https = require('https');
const url = 'https://www.zhenwu.fun/index.html';
const req = https.request(url, (r) => {
    console.log('Status:', r.statusCode);
    console.log('Content-Type:', r.headers['content-type']);
    console.log('Cache-Control:', r.headers['cache-control']);
    console.log('ETag:', r.headers['etag']);
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
        // Find data-perm.js version
        const idx = d.indexOf('data-perm.js');
        if (idx >= 0) {
            const snippet = d.slice(idx - 10, idx + 30);
            console.log('data-perm.js tag:', snippet);
        }
    });
});
req.on('error', e => console.error('Error:', e.message));
req.end();

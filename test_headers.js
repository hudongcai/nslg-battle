const https = require('https');
const url = 'https://www.zhenwu.fun/data-perm.js';
const req = https.request(url, (r) => {
    console.log('Status:', r.statusCode);
    console.log('Content-Type:', r.headers['content-type']);
    console.log('Content-Length:', r.headers['content-length']);
    console.log('Cache-Control:', r.headers['cache-control']);
    console.log('ETag:', r.headers['etag']);
    console.log('Last-Modified:', r.headers['last-modified']);
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
        console.log('Body size:', Buffer.byteLength(d));
        console.log('Has renderDataPerm:', d.includes('renderDataPerm'));
    });
});
req.on('error', e => console.error('Error:', e.message));
req.end();

const https = require('https');
const url = 'https://www.zhenwu.fun/data-perm.js';
const req = https.get(url, (r) => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
        const b = Buffer.from(d);
        console.log('Size:', b.length);
        console.log('First 20 bytes (hex):', b.slice(0, 20).toString('hex'));
        console.log('LF count:', (d.match(/\n/g) || []).length);
        console.log('CRLF count:', (d.match(/\r\n/g) || []).length);
        console.log('Has renderDataPerm:', d.includes('function renderDataPerm'));
        console.log('First 300 chars:', JSON.stringify(d.slice(0, 300)));
    });
});
req.on('error', e => console.error(e));

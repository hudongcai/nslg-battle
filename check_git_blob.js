const zlib = require('zlib');
const fs = require('fs');
const b = fs.readFileSync('E:/nslg-battle/.git/objects/a8/2c89d9079d2f7b7db4a1a6e4fb2a5782eb2fdd');
const dec = zlib.inflateRawSync(b.slice(2));
const header = dec.slice(0, 50).toString('ascii');
const nullIdx = header.indexOf('\0');
const content = dec.slice(nullIdx + 1);
console.log('Header:', header.slice(0, nullIdx));
console.log('Content size:', content.length);
console.log('First bytes:', content.slice(0, 8).toString('hex'));
const isUTF16LE = content[0] === 0xFF && content[1] === 0xFE;
console.log('Is UTF-16LE:', isUTF16LE);
if (isUTF16LE) {
    const asUtf8 = content.toString('utf8');
    console.log('As UTF-8 length:', asUtf8.length);
    console.log('First line:', asUtf8.split('\n')[0]);
}

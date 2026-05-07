const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

// Read the actual git loose object
const objPath = 'E:/nslg-battle/.git/objects/a8/2c89d9079d2f7b7db4a1a6e4fb2a5782eb2fdd';
const objData = fs.readFileSync(objPath);
const decompressed = zlib.inflateRawSync(objData.slice(2));
const header = decompressed.slice(0, 50).toString('ascii');
const nullIdx = header.indexOf('\0');
const blobContent = decompressed.slice(nullIdx + 1);

console.log('=== Git loose object (actual) ===');
console.log('Size:', blobContent.length);
console.log('First bytes:', blobContent.slice(0, 12).toString('hex'));
console.log('First 3 lines:');
const lines = blobContent.toString('utf8').split('\n').slice(0, 3);
lines.forEach((l, i) => console.log(i + ':', l));

// SHA of actual blob
const sha1 = crypto.createHash('sha1');
sha1.update('blob ' + blobContent.length + '\0');
sha1.update(blobContent);
console.log('SHA:', sha1.digest('hex'));

// Check if renderDataPerm exists
console.log('Has renderDataPerm:', blobContent.includes('async function renderDataPerm'));
console.log('Has renderDataPerm (string):', blobContent.toString('utf8').includes('renderDataPerm'));

// Check the local file
const local = fs.readFileSync('E:/nslg-battle/data-perm.js');
console.log('\n=== Local file ===');
console.log('Size:', local.length);
console.log('First bytes:', local.slice(0, 12).toString('hex'));

// Compare byte by byte
let diff = -1;
const min = Math.min(blobContent.length, local.length);
for (let i = 0; i < min; i++) {
    if (blobContent[i] !== local[i]) {
        diff = i;
        break;
    }
}
console.log('First byte diff:', diff);
if (diff >= 0) {
    console.log('Git byte', diff, ':', blobContent.slice(diff, diff+5).toString('hex'), '=', blobContent.slice(diff, diff+3).toString('utf8'));
    console.log('Local byte', diff, ':', local.slice(diff, diff+5).toString('hex'), '=', local.slice(diff, diff+3).toString('utf8'));
}

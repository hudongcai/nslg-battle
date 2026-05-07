const fs = require('fs');
const crypto = require('crypto');

const blob = fs.readFileSync('E:/nslg-battle/git_blob_20840.js');
const local = fs.readFileSync('E:/nslg-battle/data-perm.js');

console.log('Git blob size:', blob.length);
console.log('Local file size:', local.length);

// Compute SHA of git blob
const shasum1 = crypto.createHash('sha1');
shasum1.update('blob ' + blob.length + '\0');
shasum1.update(blob);
console.log('Git blob SHA:', shasum1.digest('hex'));

// Compute SHA of local
const shasum2 = crypto.createHash('sha1');
shasum2.update('blob ' + local.length + '\0');
shasum2.update(local);
console.log('Local SHA:', shasum2.digest('hex'));

// Check first diff
let firstDiff = -1;
const minLen = Math.min(blob.length, local.length);
for (let i = 0; i < minLen; i++) {
    if (blob[i] !== local[i]) {
        firstDiff = i;
        break;
    }
}
console.log('First diff at byte:', firstDiff);
if (firstDiff >= 0) {
    console.log('Blob around diff:', blob.slice(Math.max(0,firstDiff-10), firstDiff+20).toString('utf8'));
    console.log('Local around diff:', local.slice(Math.max(0,firstDiff-10), firstDiff+20).toString('utf8'));
}

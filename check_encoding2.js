const fs = require('fs');
const gitVer = fs.readFileSync('E:/nslg-battle/test_git_version.js').toString('utf16le');
const local = fs.readFileSync('E:/nslg-battle/data-perm.js').toString('utf8');

// Find first difference
let firstDiff = -1;
const max = Math.min(gitVer.length, local.length);
for (let i = 0; i < max; i++) {
    if (gitVer[i] !== local[i]) {
        firstDiff = i;
        break;
    }
}

console.log('Git version length:', gitVer.length);
console.log('Local length:', local.length);
console.log('First diff at char:', firstDiff);
if (firstDiff >= 0) {
    console.log('Around diff:', JSON.stringify(gitVer.slice(Math.max(0,firstDiff-20), firstDiff+20)));
    console.log('Local around diff:', JSON.stringify(local.slice(Math.max(0,firstDiff-20), firstDiff+20)));
}

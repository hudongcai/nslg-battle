const fs = require('fs');
const b = fs.readFileSync('E:/nslg-battle/test_git_version.js');
const local = fs.readFileSync('E:/nslg-battle/data-perm.js');
console.log('git version first bytes:', b.slice(0, 8).toString('hex'));
console.log('local first bytes:', local.slice(0, 8).toString('hex'));
console.log('git version size:', b.length);
console.log('local size:', local.length);
// Check if UTF-16 BOM
const isUTF16LE = b[0] === 0xFF && b[1] === 0xFE;
const isUTF16BE = b[0] === 0xFE && b[1] === 0xFF;
console.log('git is UTF-16LE:', isUTF16LE);
console.log('git is UTF-16BE:', isUTF16BE);
// Convert UTF-16LE to UTF-8 string
if (isUTF16LE) {
    const str = b.toString('utf16le');
    const localStr = local.toString('utf8');
    console.log('\nConverted git version length:', str.length);
    console.log('Converted local version length:', localStr.length);
    console.log('Match?', str === localStr);
    // Check renderDataPerm in converted
    console.log('renderDataPerm in converted git version:', str.includes('renderDataPerm'));
}

const fs = require('fs');

// Read the local (correct UTF-8) data-perm.js
const content = fs.readFileSync('E:/nslg-battle/data-perm.js', 'utf8');
// Write as pure UTF-8 without BOM
fs.writeFileSync('E:/nslg-battle/data-perm-fixed.js', content, 'utf8');
console.log('Converted. Size:', content.length, 'bytes');

// Verify the new file
const newFile = fs.readFileSync('E:/nslg-battle/data-perm-fixed.js');
console.log('First bytes:', newFile.slice(0, 8).toString('hex'));
console.log('Has BOM:', newFile[0] === 0xEF && newFile[1] === 0xBB && newFile[2] === 0xBF);

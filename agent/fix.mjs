import fs from 'fs';
const path = '../app/src/lib/idl/smartfarmer.json';
let data = fs.readFileSync(path, 'utf8');
data = data.replace(/"pubkey"/g, '"publicKey"');
fs.writeFileSync(path, data);
console.log('Reverted pubkey to publicKey!');

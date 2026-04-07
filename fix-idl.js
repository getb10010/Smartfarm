const fs = require('fs');
const path = 'app/src/lib/idl/smartfarmer.json';
let data = fs.readFileSync(path, 'utf8');
data = data.replace(/"publicKey"/g, '"pubkey"');
fs.writeFileSync(path, data);
console.log('Fixed IDL!');

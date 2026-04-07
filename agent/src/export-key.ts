import bs58 from 'bs58';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const PRIVATE_KEY_BASE58 = '3cyF1XCNbQZjxya1JdF6HBNbxjbbbSHywdRsdnkvXxDzk6wsUf5EfsCDqGJBPku8KmcLc1XctQKC8LbNfaGtuepU';

const secretKey = bs58.decode(PRIVATE_KEY_BASE58);
const jsonArray = JSON.stringify(Array.from(secretKey));

const outPath = resolve(process.env.USERPROFILE || '', '.config/solana/smartfarmer-deployer.json');
writeFileSync(outPath, jsonArray);
console.log('✅ Keypair saved to:', outPath);
console.log('   Array length:', secretKey.length);

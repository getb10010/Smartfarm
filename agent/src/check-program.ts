import { Connection, PublicKey } from '@solana/web3.js';

const RPC = 'https://devnet.helius-rpc.com/?api-key=b7b4abff-7ed7-44f8-9b05-f21112d18bb3';
const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const info = await conn.getAccountInfo(new PublicKey(PROGRAM_ID));
  if (info) {
    console.log('✅ Program EXISTS on Devnet');
    console.log('   Owner:', info.owner.toBase58());
    console.log('   Executable:', info.executable);
    console.log('   Data length:', info.data.length);
  } else {
    console.log('❌ Program NOT FOUND on Devnet');
    console.log('   You need to deploy the program first: anchor build && anchor deploy');
  }
}

main().catch(console.error);

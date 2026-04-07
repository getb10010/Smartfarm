import dotenv from 'dotenv';
dotenv.config();

import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const idlPath = resolve(__dirname, '../../app/src/lib/idl/smartfarmer.json');
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'));

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const PROGRAM_ID = new PublicKey(process.env.CONTRACT_PROGRAM_ID || '2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n');

// USDC Devnet mint (стандартный тестовый)
const USDC_DEVNET_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

if (!PRIVATE_KEY) {
  throw new Error('❌ SOLANA_PRIVATE_KEY is missing. Set it in agent/.env');
}

async function main() {
  const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idlJson as any, PROGRAM_ID, provider);

  console.log('👤 Admin (deployer):', wallet.publicKey.toBase58());
  console.log('📋 Program ID:', PROGRAM_ID.toBase58());

  // Derive PDAs matching the smart contract seeds
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('insurance_pool'), wallet.publicKey.toBuffer()],
    program.programId
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    program.programId
  );

  console.log('🏦 Pool PDA:', poolPda.toBase58());
  console.log('🔐 Vault PDA:', vaultPda.toBase58());

  // Oracle authority = same as admin for now (can update later to TEE key)
  const oracleAuthority = wallet.publicKey;

  try {
    const tx = await program.methods
      .initializePool(oracleAuthority)
      .accounts({
        admin: wallet.publicKey,
        pool: poolPda,
        vault: vaultPda,
        tokenMint: USDC_DEVNET_MINT,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log('✅ Pool Initialized successfully!');
    console.log('📝 Transaction Signature:', tx);
    console.log('');
    console.log('🚀 READY! You can now:');
    console.log('   1. Run the agent:    cd agent && npm run dev');
    console.log('   2. Run the frontend: cd app && npm run dev');
  } catch (error: any) {
    if (error.message?.includes('already in use') || error.logs?.some((l: string) => l.includes('already in use'))) {
      console.log('ℹ️  Pool already initialized. Everything is good!');
    } else {
      console.error('❌ Error initializing pool:', error.message || error);
      if (error.logs) {
        console.error('📋 Logs:', error.logs);
      }
    }
  }
}

main().catch(console.error);

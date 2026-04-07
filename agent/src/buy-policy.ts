import * as dotenv from "dotenv";
dotenv.config();

import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const idlPath = resolve(__dirname, "../../app/src/lib/idl/smartfarmer.json");
const idlJson = JSON.parse(readFileSync(idlPath, "utf-8"));

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const PROGRAM_ID = new PublicKey(
  process.env.CONTRACT_PROGRAM_ID || "2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n"
);
const POOL_ADMIN = new PublicKey("GA6jvomaWL41c5aPX8GnHxq2b2DD9h9GyxZpxSVbZYbr");

if (!PRIVATE_KEY) throw new Error("Missing SOLANA_PRIVATE_KEY");

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const farmerKeypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));
  
  const provider = new AnchorProvider(connection, new Wallet(farmerKeypair), {
    commitment: "confirmed",
  });
  const program = new Program(idlJson as any, PROGRAM_ID, provider);

  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_pool"), POOL_ADMIN.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    PROGRAM_ID
  );

  // Get pool to find policy count
  const pool = await (program.account as any).insurancePool.fetch(poolPda);
  const policyId = pool.policyCount?.toNumber?.() ?? pool.policyCount;

  const policyBuf = Buffer.alloc(8);
  policyBuf.writeBigUInt64LE(BigInt(policyId), 0);
  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), poolPda.toBuffer(), policyBuf],
    PROGRAM_ID
  );

  // Get farmer's token account for the pool's token mint
  const farmerAta = getAssociatedTokenAddressSync(pool.tokenMint, farmerKeypair.publicKey);

  console.log("🌾 Purchasing test policy...");
  console.log(`   Farmer: ${farmerKeypair.publicKey.toBase58()}`);
  console.log(`   Pool: ${poolPda.toBase58()}`);
  console.log(`   Policy ID: ${policyId}`);

  // Туркестанская область, Казахстан — координаты реального поля
  const latitude = 43_300_000;   // 43.3° N
  const longitude = 68_250_000;  // 68.25° E
  
  const now = Math.floor(Date.now() / 1000);

  await program.methods
    .purchasePolicy(
      new BN(latitude),           // latitude x 1e6
      new BN(longitude),          // longitude x 1e6
      1500,                       // area: 15.00 ha
      { winterWheat: {} },        // crop type
      -500,                       // frost trigger: -5.00°C
      2000,                       // drought trigger: 20.00mm
      14,                         // drought period: 14 days
      4000,                       // NDVI drop trigger: 0.40 (40%)
      new BN(100_000_000),        // premium: 100 SFC (6 decimals)
      new BN(1_000_000_000),      // max coverage: 1000 SFC
      new BN(now - 86400),        // coverage start: yesterday
      new BN(now + 90 * 86400),   // coverage end: +90 days
    )
    .accounts({
      farmer: farmerKeypair.publicKey,
      pool: poolPda,
      policy: policyPda,
      farmerTokenAccount: farmerAta,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Test policy purchased! Policy PDA:", policyPda.toBase58());
  console.log("   Координаты: [43.3, 68.25] — Туркестанская область");
  console.log("   Культура: Озимая пшеница");
  console.log("   Триггеры: заморозки < -5°C, засуха < 20мм за 14 дней");
}

main().catch(console.error);

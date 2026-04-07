import * as dotenv from "dotenv";
dotenv.config();

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const idlPath = resolve(__dirname, "../../app/src/lib/idl/smartfarmer.json");
const idlJson = JSON.parse(readFileSync(idlPath, "utf-8"));

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const PROGRAM_ID = new PublicKey(
  process.env.CONTRACT_PROGRAM_ID ||
    "2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n"
);

if (!PRIVATE_KEY) throw new Error("Missing SOLANA_PRIVATE_KEY");

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const deployerKeypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));
  
  console.log("🛠️ Deployer (You):", deployerKeypair.publicKey.toBase58());

  // 1. Создаем нового админа для ПУЛА (чтобы не поймать ошибку already in use)
  const poolAdminKeypair = Keypair.generate();
  console.log("🏦 New Pool Admin:", poolAdminKeypair.publicKey.toBase58());

  // Дадим пулу 0.1 SOL от деплойера для создания аккаунтов (вместо крана, который часто висит)
  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployerKeypair.publicKey,
      toPubkey: poolAdminKeypair.publicKey,
      lamports: 0.1 * 1e9, // 0.1 SOL
    })
  );
  await connection.sendTransaction(transferTx, [deployerKeypair]);
  console.log("💧 Transferred 0.1 SOL to new admin from deployer");

  // 2. Создаем наш СОБСТВЕННЫЙ токен (SmartFarmer Coin - 6 decimals)
  console.log("🪙 Creating new SPL Token (SmartFarmer Coins)...");
  const mint = await createMint(
    connection,
    deployerKeypair, // платит комиссию
    deployerKeypair.publicKey, // mint authority
    null,
    6 // decimals
  );
  console.log("✨ New Token Mint:", mint.toBase58());

  // 3. Чеканим 1,000,000 токенов (1_000_000 * 10^6) Деплойеру (Вашему Phantom)
  console.log("💸 Minting tokens to your Phantom wallet...");
  const userAta = await getOrCreateAssociatedTokenAccount(
    connection,
    deployerKeypair,
    mint,
    deployerKeypair.publicKey
  );
  
  await mintTo(
    connection,
    deployerKeypair,
    mint,
    userAta.address,
    deployerKeypair,
    1_000_000_000_000 // 1 миллион монет
  );
  console.log("✅ 1,000,000 SFC (SmartFarmer Coins) minted to your wallet!");

  // 4. Инициализируем НОВЫЙ пул от лица нового админа
  const provider = new AnchorProvider(connection, new Wallet(poolAdminKeypair), {
    commitment: "confirmed",
  });
  const program = new Program(idlJson as any, PROGRAM_ID, provider);

  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_pool"), poolAdminKeypair.publicKey.toBuffer()],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    program.programId
  );

  console.log("🏦 Initializing pool PDA:", poolPda.toBase58());

  await program.methods
    .initializePool(deployerKeypair.publicKey) // Оракул = Деплойер
    .accounts({
      admin: poolAdminKeypair.publicKey,
      pool: poolPda,
      vault: vaultPda,
      tokenMint: mint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([poolAdminKeypair])
    .rpc();

  console.log("🎉 SUCCESS! New Pool Created.");
  
  // Обновляем страницу фронтенда, чтобы она использовала нового админа!
  const frontendPath = resolve(__dirname, "../../app/src/pages/PoliciesPage.tsx");
  let frontendCode = readFileSync(frontendPath, "utf-8");
  frontendCode = frontendCode.replace(
    /const POOL_ADMIN = new PublicKey\(".*?"\);/,
    `const POOL_ADMIN = new PublicKey("${poolAdminKeypair.publicKey.toBase58()}");`
  );
  writeFileSync(frontendPath, frontendCode);
  console.log("📝 Updated PoliciesPage.tsx with the new POOL_ADMIN");
  
  const frontendPath2 = resolve(__dirname, "../../app/src/lib/useSmartFarmer.ts");
  let frontendCode2 = readFileSync(frontendPath2, "utf-8");
  frontendCode2 = frontendCode2.replace(
    /const POOL_ADMIN = new PublicKey\('.*?'\);/,
    `const POOL_ADMIN = new PublicKey('${poolAdminKeypair.publicKey.toBase58()}');`
  );
  writeFileSync(frontendPath2, frontendCode2);
  console.log("📝 Updated useSmartFarmer.ts with the new POOL_ADMIN");
}

main().catch(console.error);

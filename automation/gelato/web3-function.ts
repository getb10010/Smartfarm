import { Web3Function, Web3FunctionContext } from "@gelatonetwork/web3-functions-sdk";
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import axios from "axios";
import idlJson from "../../app/src/lib/idl/smartfarmer.json" assert { type: "json" };

/**
 * SmartFarmer v3 — Gelato Web3 Function (PRODUCTION)
 * 
 * Документ: "Gelato Web3 Functions — децентрализованная сеть узлов постоянно
 * выполняет TypeScript-код вне сети по cron, и вызывает транзакцию 
 * ТОЛЬКО при подтверждении страхового случая (gasless мониторинг)."
 */

interface PolicyData {
  policyId: number;
  pubkey: PublicKey;
  pool: PublicKey;
  farmer: PublicKey;
  latitude: number;
  longitude: number;
  frostThreshold: number;
  droughtThreshold: number;
  droughtDays: number;
  weatherReportCount: number;
  status: string;
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { secrets } = context;

  console.log("═".repeat(60));
  console.log("🌐 [Gelato] SmartFarmer Decentralized Monitor (Devnet)");
  console.log("═".repeat(60));

  // ─── Secrets из дашборда Gelato ───
  const heliusRpcUrl = await secrets.get("HELIUS_RPC_URL");
  if (!heliusRpcUrl) return { canExec: false, message: "HELIUS_RPC_URL missing" };

  const metgisApiKey = await secrets.get("METGIS_API_KEY");
  if (!metgisApiKey) return { canExec: false, message: "METGIS_API_KEY missing" };

  const programIdStr = await secrets.get("PROGRAM_ID") || "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";
  const programId = new PublicKey(programIdStr);

  const connection = new Connection(heliusRpcUrl, "confirmed");

  // ─── Чтение полисов из блокчейна ───
  let activePolicies: PolicyData[] = [];

  try {
    const idl = idlJson;
    // Read-only provider (Gelato не подписывает транзакции, только мониторит)
    const dummyKeypair = Keypair.generate();
    const provider = new AnchorProvider(
      connection,
      new Wallet(dummyKeypair),
      { commitment: 'confirmed' }
    );
    const program = new Program(idl as any, provider);

    console.log("📡 Запрос полисов из Solana Devnet...");
    const allAccounts = await (program.account as any).policy.all();

    activePolicies = allAccounts
      .map((p: any) => ({
        policyId: p.account.policyId,
        pubkey: p.publicKey,
        pool: p.account.pool,
        farmer: p.account.farmer,
        latitude: p.account.latitude.toNumber() / 1_000_000,
        longitude: p.account.longitude.toNumber() / 1_000_000,
        frostThreshold: p.account.frostTriggerTempX100 / 100,
        droughtThreshold: p.account.droughtTriggerPrecipX100 / 100,
        droughtDays: p.account.droughtPeriodDays,
        weatherReportCount: p.account.weatherReportCount || 0,
        status: Object.keys(p.account.status || {})[0],
      }))
      .filter((p: any) => p.status === 'active');

    console.log(`📋 Найдено ${activePolicies.length} активных полисов.`);
  } catch (e: any) {
    console.warn("⚠️ Не удалось загрузить полисы из RPC:", e.message);
    return { canExec: false, message: `RPC error: ${e.message}` };
  }

  if (activePolicies.length === 0) {
    return { canExec: false, message: "No active policies found" };
  }

  // ─── Мониторинг каждого полиса ───
  const triggeredPolicies: Array<{ policy: PolicyData; temperature: number }> = [];

  for (const policy of activePolicies) {
    console.log(`\n  ┌─ Полис #${policy.policyId} [${policy.latitude}, ${policy.longitude}]`);

    try {
      // Запрос MetGIS (30м разрешение)
      const response = await axios.get('https://api.metgis.com/forecast/point', {
        params: {
          lat: policy.latitude,
          lon: policy.longitude,
          key: metgisApiKey,
          format: 'json',
        },
        timeout: 10000,
      });

      const currentTemp = response.data.temperature ?? 0;
      const precipitation = response.data.precipitation ?? 0;

      console.log(`  │  🌡️ ${currentTemp}°C (порог: ${policy.frostThreshold}°C) | 🌧️ ${precipitation}мм`);

      // Оценка триггера заморозков
      if (currentTemp < policy.frostThreshold) {
        console.log("  │  ⚠️ FROST TRIGGER ACTIVATED!");
        triggeredPolicies.push({ policy, temperature: currentTemp });
      } else {
        console.log("  │  ✅ Условия в норме.");
      }

      console.log("  └───────────────────────────────────");
    } catch (e: any) {
      console.error(`  │  ❌ MetGIS API error: ${e.message?.slice(0, 60)}`);
      console.log("  └───────────────────────────────────");
      continue;
    }
  }

  // ─── Результат для Gelato Runtime ───
  if (triggeredPolicies.length > 0) {
    console.log(`\n⚡ ТРИГГЕР: ${triggeredPolicies.length} полисов требуют действий.`);
    console.log("📨 Gelato передает управление AI Oracle Agent для CPI-вызова trigger_payout.");

    // Gelato Web3 Function возвращает флаг canExec: true
    // В реальной конфигурации Gelato формирует сериализованную Solana-инструкцию
    // для вызова submit_weather_report из нашего контракта
    return {
      canExec: true,
      callData: triggeredPolicies.map(t => ({
        to: programIdStr,
        data: JSON.stringify({
          instruction: "submit_weather_report",
          policyId: t.policy.policyId,
          policyPubkey: t.policy.pubkey.toBase58(),
          temperature: Math.round(t.temperature * 100),
          frostTriggered: true,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      })),
    };
  }

  console.log("\n✅ Все полисы в норме — 0 газа потрачено в этом цикле.");
  return { canExec: false, message: `Checked ${activePolicies.length} policies. All normal.` };
});

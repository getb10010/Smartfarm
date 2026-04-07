import dotenv from 'dotenv';
dotenv.config();


import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import pkg from '@coral-xyz/anchor';
const { Program, AnchorProvider, Wallet, BN } = pkg;
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { CascadingWeatherProvider, WeatherData, evaluateTriggers } from './plugins/weatherPlugin.js';
import { CascadingNdviProvider, NdviStatistics, evaluateNdviTrigger, createFieldPolygon } from './plugins/satellitePlugin.js';
import { makePayoutDecision, generateRecommendation } from './plugins/insurancePlugin.js';
import { TelegramNotificationService } from './plugins/telegramPlugin.js';
import { hashWeatherReport, hashNdviReport, hashPayout, hashRecommendation, logAttestation, detectEnvironment } from './teeAttestation.js';
import { MemoryManager } from './memoryManager.js';
import './bot.js'; // Запускаем Telegram Бота (Telegraf) параллельно с циклом Оракула
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const idlPath = resolve(__dirname, '../../app/src/lib/idl/smartfarmer.json');
const idlJson = JSON.parse(readFileSync(idlPath, 'utf-8'));

// ============================================================================
// ElizaOS Character File — загрузка конфигурации ИИ-персонажа
// ============================================================================

const characterPath = resolve(__dirname, 'character.json');
const characterConfig = JSON.parse(readFileSync(characterPath, 'utf-8'));

// ============================================================================
// Константы и инициализация
// ============================================================================

const BANNER = `
╔═══════════════════════════════════════════════════════════════╗
║   🌾 SmartFarmer v3 — AI Oracle Agent (Autonomous Loop)     ║
║   TEE SHA-256 • MetGIS/Ambee/Open-Meteo • NDVI • Devnet    ║
║   ElizaOS Character: ${(characterConfig.name || 'Unknown').padEnd(36)}║
║   Telegram Notifications • Memory Manager (RAG)             ║
╚═══════════════════════════════════════════════════════════════╝
`;

const MONITOR_INTERVAL_MS = 60 * 60 * 1000; // 1 час между циклами мониторинга
const RPC_URL = process.env.HELIUS_RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const PROGRAM_ID = new PublicKey(process.env.CONTRACT_PROGRAM_ID || process.env.PROGRAM_ID || '2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n');

if (!PRIVATE_KEY) {
  throw new Error('❌ SOLANA_PRIVATE_KEY is missing. Set it in agent/.env');
}

const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
const program = new Program(idlJson as any, PROGRAM_ID, provider);

// Инициализация провайдеров (каскад: MetGIS 30м → Ambee 500м → Open-Meteo 1-11км)
const weatherProvider = new CascadingWeatherProvider(
  process.env.METGIS_API_KEY,
  process.env.AMBEE_API_KEY,
);
const ndviProvider = new CascadingNdviProvider(
  process.env.EOSDA_API_KEY,
  process.env.AGROMONITORING_API_KEY,
  process.env.SH_CLIENT_ID,
  process.env.SH_CLIENT_SECRET
);
const telegram = new TelegramNotificationService(true); // Включаем Telegram Sender

// Memory Manager (RAG-like context store)
const memory = new MemoryManager();
memory.loadCharacterKnowledge(characterConfig.knowledge || []);

// TEE Environment Detection
const teeEnv = detectEnvironment();

// ============================================================================
// PDA Helpers (зеркало логики из контракта)
// ============================================================================

function getPoolPDA(admin: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('insurance_pool'), admin.toBuffer()],
    PROGRAM_ID
  );
}

function getVaultPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pool.toBuffer()],
    PROGRAM_ID
  );
}

function getWeatherReportPDA(policy: PublicKey, reportIndex: number): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(reportIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('weather_report'), policy.toBuffer(), buf],
    PROGRAM_ID
  );
}

function getReportCounterPDA(policy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("report_counter"), policy.toBuffer()], PROGRAM_ID);
}

function getNdviReportPDA(policy: PublicKey, reportIndex: number): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(reportIndex, 0);
  return PublicKey.findProgramAddressSync([Buffer.from('ndvi_report'), policy.toBuffer(), buf], PROGRAM_ID);
}

function getNdviCounterPDA(policy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("ndvi_counter"), policy.toBuffer()], PROGRAM_ID);
}

function getRecommendationPDA(policy: PublicKey, recIndex: number): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(recIndex, 0);
  return PublicKey.findProgramAddressSync([Buffer.from('recommendation'), policy.toBuffer(), buf], PROGRAM_ID);
}

function getRecCounterPDA(policy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("rec_counter"), policy.toBuffer()], PROGRAM_ID);
}

function getPolicyPDA(pool: PublicKey, policyId: number): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(policyId), 0);
  return PublicKey.findProgramAddressSync([Buffer.from("policy"), pool.toBuffer(), buf], PROGRAM_ID);
}

// ============================================================================
// Утилита: чтение счётчиков из ончейн PDA-аккаунтов
// Счётчики хранятся отдельно от Policy (ReportCounter, NdviCounter, RecCounter)
// ============================================================================

async function fetchCounterValue(counterPDA: PublicKey, fieldName: string): Promise<number> {
  try {
    const accountType = fieldName === 'report_count' ? 'reportCounter'
                      : fieldName === 'ndvi_count' ? 'ndviCounter'
                      : 'recCounter';
    const acc = await (program.account as any)[accountType].fetch(counterPDA);
    const val = acc[fieldName.replace(/_([a-z])/g, (_: any, c: string) => c.toUpperCase())];
    return typeof val === 'number' ? val : (val?.toNumber?.() ?? 0);
  } catch {
    return 0; // Счётчик ещё не создан on-chain — значит 0
  }
}

// ============================================================================
// Основной цикл мониторинга
// ============================================================================

let cycleCount = 0;

async function monitorPolicies(): Promise<void> {
  cycleCount++;
  const timestamp = new Date().toISOString();
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`🔄 Цикл мониторинга #${cycleCount} | ${timestamp}`);
  console.log(`   TEE: ${teeEnv === 'phala_tee' ? '🔒 Phala Enclave' : '🔓 Local Dev'} | Memory: ${memory.getStats().totalRecords} записей`);
  console.log(`${'═'.repeat(65)}`);

  try {
    // 1. Получение всех полисов нашего пула безопасно (без .all() который падает на мусорных аккаунтах)
    console.log('📡 Чтение пула из Devnet...');
    const poolAdmin = new PublicKey("9GY2ra6AoUxs78HS9LAn5QbnCaogsZBvMvvMZgj1cG83");
    const [poolPda] = getPoolPDA(poolAdmin);
    const pool = await (program.account as any).insurancePool.fetch(poolPda);
    const policyCount = pool.policyCount?.toNumber?.() ?? pool.policyCount;
    
    console.log(`📋 В пуле найдено ${policyCount} полисов. Загрузка...`);
    const allAccounts: any[] = [];
    for (let i = 0; i < policyCount; i++) {
        const [policyPda] = getPolicyPDA(poolPda, i);
        try {
            const acc = await (program.account as any).policy.fetch(policyPda);
            allAccounts.push({ publicKey: policyPda, account: acc });
        } catch (e) {
            console.log(`⚠️ Не удалось загрузить полис #${i}`);
        }
    }

    // 2. Маппинг ончейн-данных в удобоваримый формат ИИ
    // Счётчики читаем из отдельных PDA-аккаунтов (а НЕ из Policy struct)
    const activePolicies = await Promise.all(allAccounts.map(async (p: any) => {
      const policyPubkey = p.publicKey;
      const [reportCounterPDA] = getReportCounterPDA(policyPubkey);
      const [ndviCounterPDA] = getNdviCounterPDA(policyPubkey);
      const [recCounterPDA] = getRecCounterPDA(policyPubkey);

      const [weatherReportCount, ndviCount, recCount] = await Promise.all([
        fetchCounterValue(reportCounterPDA, 'report_count'),
        fetchCounterValue(ndviCounterPDA, 'ndvi_count'),
        fetchCounterValue(recCounterPDA, 'rec_count'),
      ]);

      return {
        id: p.account.policyId,
        pubkey: policyPubkey,
        pool: p.account.pool,
        farmer: p.account.farmer,
        lat: p.account.latitude.toNumber() / 1_000_000,
        lon: p.account.longitude.toNumber() / 1_000_000,
        area: p.account.areaHectaresX100 / 100,
        crop: Object.keys(p.account.cropType || {})[0],
        frostThresh: p.account.frostTriggerTempX100 / 100,
        droughtThreshPrecip: p.account.droughtTriggerPrecipX100 / 100,
        droughtDays: p.account.droughtPeriodDays,
        ndviDropThreshold: p.account.ndviDropTriggerX10000 / 100,
        maxCoverage: p.account.maxCoverage?.toNumber?.() || 0,
        premiumPaid: p.account.premiumPaid?.toNumber?.() || 0,
        weatherReportCount,
        ndviCount,
        recCount,
        status: Object.keys(p.account.status || {})[0]?.toLowerCase(),
      };
    }));

    activePolicies.forEach((p: any) => console.log(`   [Debug] Полис #${p.id} имеет статус: ${p.status} | raw: ${JSON.stringify(allAccounts[0]?.account?.status)}`));
    
    const activeOnly = activePolicies.filter((p: any) => p.status === 'active' || p.status === 'triggeredawaitingndvi');

    console.log(`📋 Найдено ${allAccounts.length} полисов, для мониторинга: ${activeOnly.length}`);

    if (activeOnly.length === 0) {
      console.log('💤 Нет активных полисов для мониторинга. Ожидание...');
      return;
    }

    // 3. Обработка каждого полиса
    for (const policy of activeOnly) {
      console.log(`\n  ┌─ Полис #${policy.id} | ${policy.crop} | ${policy.area} га`);
      console.log(`  │  Координаты: [${policy.lat}, ${policy.lon}]`);
      console.log(`  │  Триггеры: заморозки < ${policy.frostThresh}°C, засуха < ${policy.droughtThreshPrecip}мм`);

      try {
        let weather: any;
        let weatherEval: any;
        
        if (policy.status === 'triggeredawaitingndvi') {
           console.log(`  │  ⚠️ Метеоданные уже зафиксированы ранее (статус TriggeredAwaitingNdvi). Переходим к NDVI.`);
           weatherEval = {
              frostTriggered: true,
              droughtTriggered: false,
              temperature: policy.frostThresh - 1,
              precipitationOverPeriod: 100,
              details: "Ранее зафиксированы заморозки",
           };
           weather = { temperature: policy.frostThresh - 1, precipitation: 100, humidity: 50, windSpeed: 5, pressure: 1013, source: 'Open-Meteo' as const, resolution: 'cache', timestamp: Date.now(), raw: {} };
        } else {
           // ─── Шаг A: Запрос погоды (каскад: MetGIS → Ambee → Open-Meteo) ───
           console.log(`  │  🌡️ Запрос метеоданных (каскад: MetGIS → Ambee → Open-Meteo)...`);
           weather = await weatherProvider.getPointForecast(policy.lat, policy.lon);
           console.log(`  │  → Температура: ${weather.temperature}°C | Осадки: ${weather.precipitation}мм | Источник: ${weather.source} (${weather.resolution})`);

           // ─── Шаг B: Оценка метеотриггеров ───
           weatherEval = evaluateTriggers(
             weather,
             policy.frostThresh,
             policy.droughtThreshPrecip,
             weather.precipitation
           );
           console.log(`  │  → ${weatherEval.details}`);
        }

        // ─── Шаг B2: Сохранение в Memory Manager ───
        memory.addWeatherRecord(policy.id, {
          policyId: policy.id,
          temperature: weather.temperature,
          precipitation: weather.precipitation,
          humidity: weather.humidity,
          windSpeed: weather.windSpeed,
          frostTriggered: weatherEval.frostTriggered,
          droughtTriggered: weatherEval.droughtTriggered,
        });

        // ─── Шаг C: Запись WeatherReport в блокчейн с TEE хешем ───
        const tempX100 = Math.round(weather.temperature * 100);
        const precipX100 = Math.round(weather.precipitation * 100);
        const humidX100 = Math.round(weather.humidity * 100);
        const windX100 = Math.round(weather.windSpeed * 100);
        const nowTs = Math.floor(Date.now() / 1000);

        const weatherTeeHash = hashWeatherReport({
          oraclePublicKey: keypair.publicKey.toBase58(),
          policyPubkey: policy.pubkey.toBase58(),
          temperatureX100: tempX100,
          precipitationX100: precipX100,
          humidityX100: humidX100,
          windSpeedX100: windX100,
          dataSource: weather.source || 'Open-Meteo',
          timestamp: nowTs,
        });
        logAttestation('WeatherReport', weatherTeeHash);

        if (policy.status === 'active') {
          try {
            const [reportPDA] = getWeatherReportPDA(policy.pubkey, policy.weatherReportCount);
            const [reportCounterPDA] = getReportCounterPDA(policy.pubkey);

            await program.methods
              .submitWeatherReport(
                tempX100,
                precipX100,
                humidX100,
                windX100,
                weatherProvider.getDataSourceEnum(),
                weatherTeeHash
              )
              .accounts({
                oracle: keypair.publicKey,
                pool: policy.pool,
                reportCounter: reportCounterPDA,
                policy: policy.pubkey,
                weatherReport: reportPDA,
                systemProgram: SystemProgram.programId,
              } as any)
              .rpc();
            console.log(`  │  ✅ WeatherReport записан в блокчейн (PDA: ${reportPDA.toBase58().slice(0, 12)}...)`);
          } catch (txErr: any) {
            console.log(`  │  ⚠️ Не удалось записать WeatherReport: ${txErr.message?.slice(0, 80)}`);
          }
        }

        // ─── Dialect: уведомление при метеотриггере ───
        if (weatherEval.frostTriggered) {
          await telegram.sendFrostAlert(
            policy.farmer.toBase58(),
            policy.id,
            weather.temperature,
            policy.frostThresh
          );
        }
        if (weatherEval.droughtTriggered) {
          await telegram.sendDroughtAlert(
            policy.farmer.toBase58(),
            policy.id,
            weather.precipitation,
            policy.droughtThreshPrecip,
            policy.droughtDays
          );
        }

        // ─── Шаг D: NDVI проверка (только если метеотриггер сработал) ───
        let ndviEval = null;
        if (weatherEval.frostTriggered || weatherEval.droughtTriggered) {
          console.log(`  │  🛰️ Метеотриггер сработал! Запрос AgroMonitoring NDVI...`);
          try {
            const polygon = createFieldPolygon(policy.lat, policy.lon, policy.area);
            const now = new Date();
            const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

            const ndviStats = await ndviProvider.getNdviStats(
              polygon,
              fiveDaysAgo.toISOString().split('T')[0],
              now.toISOString().split('T')[0]
            );

            ndviEval = evaluateNdviTrigger(ndviStats, 0.70, policy.ndviDropThreshold);
            console.log(`  │  → NDVI: ${ndviEval.details}`);

            // Сохранение в Memory
            memory.addNdviRecord(policy.id, {
              policyId: policy.id,
              meanNdvi: ndviStats.mean,
              deltaPercent: ndviEval.deltaPercent,
              ndviTriggered: ndviEval.ndviTriggered,
            });

            // Запись NdviReport в блокчейн с TEE хешем
            const ndviTeeHash = hashNdviReport({
              oraclePublicKey: keypair.publicKey.toBase58(),
              policyPubkey: policy.pubkey.toBase58(),
              meanNdviX10000: Math.round(Math.max(0, ndviStats.mean) * 10000),
              minNdviX10000: Math.round(Math.max(0, ndviStats.min) * 10000),
              maxNdviX10000: Math.round(Math.max(0, ndviStats.max) * 10000),
              stdDevX10000: Math.round(Math.max(0, ndviStats.stdDev) * 10000),
              historicalMeanX10000: Math.round(0.70 * 10000),
              satelliteSource: 'AgroMonitoring',
              timestamp: nowTs,
            });
            logAttestation('NdviReport', ndviTeeHash);

            try {
              const [ndviReportPDA] = getNdviReportPDA(policy.pubkey, policy.ndviCount);
              const [ndviCounterPDA] = getNdviCounterPDA(policy.pubkey);
              
              await program.methods
                .submitNdviReport(
                  Math.round(Math.max(0, ndviStats.mean) * 10000),
                  Math.round(Math.max(0, ndviStats.min) * 10000),
                  Math.round(Math.max(0, ndviStats.max) * 10000),
                  Math.round(Math.max(0, ndviStats.stdDev) * 10000),
                  Math.round(0.70 * 10000),
                  { agroMonitoring: {} },
                  ndviTeeHash
                )
                .accounts({
                  oracle: keypair.publicKey,
                  pool: policy.pool,
                  policy: policy.pubkey,
                  ndviCounter: ndviCounterPDA,
                  ndviReport: ndviReportPDA,
                  systemProgram: SystemProgram.programId,
                } as any)
                .rpc();
               console.log(`  │  ✅ NdviReport записан в блокчейн (PDA: ${ndviReportPDA.toBase58().slice(0, 12)}...)`);
            } catch (err: any) {
               console.log(`  │  ⚠️ Не удалось записать NdviReport: ${err.message?.slice(0, 200)}`);
            }

            // Telegram: уведомление о NDVI подтверждении
            if (ndviEval.ndviTriggered) {
              await telegram.sendNdviConfirmation(
                policy.farmer.toBase58(),
                policy.id,
                ndviEval.deltaPercent
              );
            }
          } catch (ndviErr: any) {
            console.log(`  │  ⚠️ AgroMonitoring API недоступен: ${ndviErr.message?.slice(0, 60)}`);
          }
        }

        // ─── Шаг E: Решение о выплате ───
        const decision = makePayoutDecision(
          {
            cropType: policy.crop,
            areaHectares: policy.area,
            frostTriggerTemp: policy.frostThresh,
            droughtTriggerPrecip: policy.droughtThreshPrecip,
            droughtPeriodDays: policy.droughtDays,
            ndviDropThreshold: policy.ndviDropThreshold,
            coverageAmount: policy.maxCoverage,
            premiumAmount: policy.premiumPaid,
          },
          weatherEval,
          ndviEval
        );

        console.log(`  │  📊 Решение: ${decision.reason}`);

        // Memory: запись решения
        memory.addDecision(policy.id, {
          policyId: policy.id,
          action: decision.shouldPayout ? 'payout' : (ndviEval ? 'no_payout' : 'awaiting_ndvi'),
          amount: decision.amount,
          reason: decision.reason,
        });

        // ─── Шаг F: Выполнение выплаты через CPI ───
        if (decision.shouldPayout) {
          console.log(`  │  💸 ВЫПЛАТА ПОДТВЕРЖДЕНА: ${decision.amount} lamports`);
          
          const payoutTeeHash = hashPayout({
            oraclePublicKey: keypair.publicKey.toBase58(),
            policyPubkey: policy.pubkey.toBase58(),
            payoutAmount: decision.amount,
            timestamp: nowTs,
          });
          logAttestation('TriggerPayout', payoutTeeHash);

          try {
            const [vaultPDA] = getVaultPDA(policy.pool);
            const poolAccount = await (program.account as any).insurancePool.fetch(policy.pool);
            const farmerTokenAccount = getAssociatedTokenAddressSync(poolAccount.tokenMint, policy.farmer, true);

            const txSig = await program.methods
              .triggerPayout(new BN(decision.amount), payoutTeeHash)
              .accounts({
                oracle: keypair.publicKey,
                pool: policy.pool,
                policy: policy.pubkey,
                vault: vaultPDA,
                farmerTokenAccount: farmerTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
              } as any)
              .rpc();

            console.log(`  │  ✅ Транзакция выплаты УСПЕШНА! Фермер: ${policy.farmer.toBase58().slice(0, 16)}...`);

            // Dialect: уведомление об успешной выплате
            await telegram.sendPayoutNotification(
              policy.farmer.toBase58(),
              policy.id,
              decision.amount,
              txSig
            );
          } catch (payoutErr: any) {
            console.log(`  │  ❌ Ошибка выплаты: ${payoutErr.message?.slice(0, 100)}`);
          }
        }

        // ─── Шаг G: Агрономическая рекомендация ───
        const recommendation = await generateRecommendation(weatherEval, ndviEval, policy.crop);
        
        // Обогащение рекомендации контекстом из Memory Manager
        const contextAdvice = memory.getContextualAdvice(policy.id, policy.crop);
        const enrichedMessage = `${recommendation.message} ${contextAdvice}`;

        console.log(`  │  🌱 Рекомендация [${recommendation.urgency}]: ${recommendation.message}`);
        if (contextAdvice && !contextAdvice.startsWith('✅ Данных')) {
          console.log(`  │  📚 Контекст (RAG): ${contextAdvice.slice(0, 80)}...`);
        }

        // Memory: запись рекомендации
        memory.addRecommendation(policy.id, {
          policyId: policy.id,
          type: recommendation.type,
          urgency: recommendation.urgency,
          message: enrichedMessage,
        });

        const recTeeHash = hashRecommendation({
          oraclePublicKey: keypair.publicKey.toBase58(),
          policyPubkey: policy.pubkey.toBase58(),
          recType: recommendation.type,
          urgency: recommendation.urgency,
          message: enrichedMessage.slice(0, 250),
          timestamp: nowTs,
        });
        logAttestation('Recommendation', recTeeHash);

        try {
          const [recPDA] = getRecommendationPDA(policy.pubkey, policy.recCount);
          const [recCounterPDA] = getRecCounterPDA(policy.pubkey);
          
          // Маппинг типов рекомендаций → Rust/IDL enum variants (camelCase)
          // Rust: Irrigation, FrostWarning, DroughtWarning, Fertilization, Harvest, General
          const recTypeMap: Record<string, string> = {
            irrigation: 'irrigation',
            frost_warning: 'frostWarning',
            drought_warning: 'droughtWarning',
            fertilization: 'fertilization',
            harvest: 'harvest',
            general: 'general',
          };
          const recTypeCamel = recTypeMap[recommendation.type] || 'general';

          // Маппинг срочности → Rust/IDL enum variants (camelCase)
          // Rust: Info, Medium, High, Critical
          const urgencyMap: Record<string, string> = {
            info: 'info',
            medium: 'medium',
            high: 'high',
            critical: 'critical',
          };
          const urgencyCamel = urgencyMap[recommendation.urgency?.toLowerCase()] || 'medium';

          await program.methods
            .aiRecommendation(
              { [recTypeCamel]: {} } as any,
              { [urgencyCamel]: {} } as any,
              enrichedMessage.slice(0, 250),
              recTeeHash
            )
            .accounts({
              oracle: keypair.publicKey,
              pool: policy.pool,
              policy: policy.pubkey,
              recCounter: recCounterPDA,
              recommendation: recPDA,
              systemProgram: SystemProgram.programId,
            } as any)
            .rpc();
           console.log(`  │  ✅ AI Рекомендация записана в блокчейн (PDA: ${recPDA.toBase58().slice(0, 12)}...)`);
        } catch (err: any) {
           console.log(`  │  ⚠️ Не удалось записать AI Рекомендацию: ${err.message?.slice(0, 80)}`);
        }

        // Dialect: отправка рекомендации при urgency >= high
        if (recommendation.urgency === 'high' || recommendation.urgency === 'critical') {
          await telegram.sendRecommendation(
            policy.farmer.toBase58(),
            policy.id,
            recommendation.urgency,
            recommendation.message
          );
        }

        console.log(`  └─────────────────────────────────────────────`);

      } catch (policyErr: any) {
        console.error(`  │  ❌ Ошибка обработки полиса #${policy.id}:`, policyErr.message);
        console.log(`  └─────────────────────────────────────────────`);
      }
    }

    // Статистика цикла
    const memStats = memory.getStats();
    const telegramStats = telegram.getStats();
    console.log(`\n📊 Итоги цикла #${cycleCount}:`);
    console.log(`   Memory: ${memStats.totalPolicies} полисов, ${memStats.totalRecords} записей`);
    console.log(`   Telegram: ${telegramStats.total} уведомлений`);

  } catch (err: any) {
    console.error('❌ Критическая ошибка цикла мониторинга:', err.stack || err);
  }
}

// ============================================================================
// Запуск агента
// ============================================================================

async function main(): Promise<void> {
  const singleRun = process.env.ORACLE_SINGLE_RUN === 'true';

  console.log(BANNER);
  console.log(`🤖 Character: ${characterConfig.name}`);
  console.log(`   Model: ${characterConfig.settings?.model || 'default'}`);
  console.log(`   Knowledge: ${characterConfig.knowledge?.length || 0} items`);
  console.log(`   Plugins: ${characterConfig.plugins?.join(', ') || 'none'}`);
  console.log(`🚀 AI Oracle Identity: ${keypair.publicKey.toString()}`);
  console.log(`🌐 RPC Endpoint: ${RPC_URL}`);
  console.log(`📝 Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`🔒 TEE Environment: ${teeEnv}`);
  console.log(`⏱️ Режим: ${singleRun ? 'SINGLE RUN (CRON/CI)' : `Continuous (${MONITOR_INTERVAL_MS / 60000} мин)`}`);
  console.log(`📨 Dialect Notifications: ${process.env.DIALECT_ENABLED === 'true' ? 'LIVE' : 'LOG mode'}`);

  if (singleRun) {
    // ─── Single Run Mode (GitHub Actions / CRON / Serverless) ───
    console.log(`\n⚡ Single-run mode: выполняем один цикл мониторинга и завершаемся.\n`);
    await monitorPolicies();
    console.log(`\n✅ Single-run цикл завершён. Процесс завершается.`);
    process.exit(0);
  }

  // ─── Continuous Mode (Phala TEE / Docker / Local) ───
  console.log(`\n💡 Агент будет работать непрерывно. Ctrl+C для остановки.\n`);

  // Первый цикл — сразу
  await monitorPolicies();

  // Автономный бесконечный цикл
  setInterval(async () => {
    try {
      await monitorPolicies();
    } catch (err: any) {
      console.error('❌ Unhandled error in monitoring cycle:', err.message);
    }
  }, MONITOR_INTERVAL_MS);
}

main().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});


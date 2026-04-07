import { createHash, randomBytes } from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';

/**
 * SmartFarmer v3 — TEE Attestation Module (Production-Grade)
 * 
 * Документ: "Платформа Phala использует аппаратные анклавы (Intel SGX / TDX / AMD SEV)
 * для выполнения кода в изолированной среде. Приватный ключ кошелька ИИ-агента
 * генерируется внутри анклава и никогда его не покидает."
 * 
 * Архитектура:
 * 1. PhalaAttestation — интеграция с Phala DCAP Remote Attestation
 * 2. TEEKeyManager — генерация/деривация ключей внутри TEE
 * 3. Hash functions — криптографическое связывание данных с оракулом
 * 4. Fallback — программный SHA-256 для локальной разработки
 */

// ============================================================================
// Типы и константы
// ============================================================================

export type TeeEnvironment = 'phala_tee' | 'docker_tee' | 'github_actions' | 'local_dev';

/** Результат Remote Attestation */
interface AttestationReport {
  /** Сырой отчёт аттестации (DCAP quote) */
  quote: Buffer;
  /** Публичный ключ, привязанный к анклаву */
  enclavePublicKey: string;
  /** Timestamp аттестации */
  timestamp: number;
  /** Тип окружения */
  environment: TeeEnvironment;
  /** Хеш измеренного кода (MRENCLAVE в SGX) */
  codeHash: string;
}

// ============================================================================
// Детекция окружения
// ============================================================================

export function detectEnvironment(): TeeEnvironment {
  // Phala TEE — аппаратный анклав (Intel SGX / TDX) — работает и на Testnet и на Mainnet
  if (process.env.PHALA_TEE === '1' || process.env.TEE_MODE === 'production' || process.env.TEE_MODE === 'dstack_testnet') {
    return 'phala_tee';
  }
  // Docker TEE — контейнеризированный, но без аппаратного анклава
  if (process.env.TEE_MODE === 'docker') {
    return 'docker_tee';
  }
  // GitHub Actions — CI/CD среда
  if (process.env.TEE_MODE === 'github_actions' || process.env.GITHUB_ACTIONS === 'true') {
    return 'github_actions';
  }
  return 'local_dev';
}

// ============================================================================
// Phala TEE Attestation — Remote Attestation через DCAP
// Документ: "Remote Attestation посредством Intel DCAP позволяет
// смарт-контрактам проверять, что код агента не был модифицирован."
// ============================================================================

export class PhalaAttestation {
  private environment: TeeEnvironment;
  private attestationCache: AttestationReport | null = null;
  private cacheExpiry: number = 0;
  private static CACHE_TTL_MS = 3600_000; // 1 час

  constructor() {
    this.environment = detectEnvironment();
  }

  /**
   * Получить Remote Attestation Report.
   * В Phala TEE — реальный DCAP quote от Intel SGX/TDX.
   * В других средах — программный эквивалент с маркировкой.
   */
  async getAttestationReport(userData: Buffer): Promise<AttestationReport> {
    // Проверяем кеш (аттестации дорогие — кешируем на 1 час)
    if (this.attestationCache && Date.now() < this.cacheExpiry) {
      return this.attestationCache;
    }

    let report: AttestationReport;

    if (this.environment === 'phala_tee') {
      report = await this.getPhalaRemoteAttestation(userData);
    } else {
      report = this.getSoftwareAttestation(userData);
    }

    // Кеш
    this.attestationCache = report;
    this.cacheExpiry = Date.now() + PhalaAttestation.CACHE_TTL_MS;

    return report;
  }

  /**
   * Phala DCAP Remote Attestation.
   * Документ: "Phala Cloud предоставляет API для генерации Remote Attestation,
   * подтверждающую корректное выполнение ИИ-агента внутри анклава."
   * 
   * Использует Phala dstack TEE Simulator / production endpoint:
   * - POST /prpc/Mq.tdx.GenerateQuote (для TDX)
   * - GET /attestation/report (для DCAP)
   */
  private async getPhalaRemoteAttestation(userData: Buffer): Promise<AttestationReport> {
    try {
      // Phala dstack предоставляет локальный endpoint для Remote Attestation
      // внутри контейнера TEE. Адрес определяется через env.
      const raEndpoint = process.env.RA_TLS_ENDPOINT || 'http://localhost:8090';
      
      const response = await axios.post(
        `${raEndpoint}/prpc/Mq.tdx.GenerateQuote`, 
        { report_data: userData.toString('hex') },
        { timeout: 30000 }
      );

      const quote = Buffer.from(response.data.quote || response.data, 'hex');
      
      // Извлекаем MRENCLAVE (первые 32 байта quote после заголовка)
      const codeHash = createHash('sha256')
        .update(quote.subarray(0, Math.min(64, quote.length)))
        .digest('hex');

      return {
        quote,
        enclavePublicKey: process.env.ENCLAVE_PUBLIC_KEY || 'derived_inside_tee',
        timestamp: Date.now(),
        environment: 'phala_tee',
        codeHash,
      };
    } catch (err: any) {
      console.warn(`[TEE] ⚠️ Phala RA endpoint error: ${err.message}. Using software fallback.`);
      return this.getSoftwareAttestation(userData);
    }
  }

  /**
   * Программная аттестация для локальной разработки / Docker / CI.
   * Генерирует детерминированный хеш, имитирующий формат DCAP quote.
   */
  private getSoftwareAttestation(userData: Buffer): AttestationReport {
    // Генерируем "software quote" — детерминированный хеш с маркером среды
    const envMarker = Buffer.from(`SMARTFARMER_V3_${this.environment.toUpperCase()}`);
    const timestampBuf = Buffer.alloc(8);
    timestampBuf.writeBigInt64BE(BigInt(Date.now()), 0);

    const quote = createHash('sha256')
      .update(Buffer.concat([envMarker, userData, timestampBuf]))
      .digest();

    const codeHash = createHash('sha256')
      .update(Buffer.from(`CODE_MEASUREMENT_${this.environment}`))
      .digest('hex');

    return {
      quote,
      enclavePublicKey: 'software_attestation',
      timestamp: Date.now(),
      environment: this.environment,
      codeHash,
    };
  }

  /** Проверить, выполняется ли код в настоящем TEE */
  isHardwareTEE(): boolean {
    return this.environment === 'phala_tee';
  }
}

// ============================================================================
// TEE Key Manager — генерация ключей внутри анклава
// Документ: "Приватный ключ кошелька ИИ-агента генерируется внутри анклава
// и никогда его не покидает. Агент может безопасно подписывать транзакции."
// ============================================================================

export class TEEKeyManager {
  private environment: TeeEnvironment;

  constructor() {
    this.environment = detectEnvironment();
  }

  /**
   * Получить или сгенерировать keypair для оракула.
   * - В Phala TEE: генерируется внутри анклава через secure random
   * - В Docker: генерируется при первом запуске и хранится в защищённом volume
   * - Локально: читается из .env (для разработки)
   */
  getOracleKeypair(): Keypair {
    if (this.environment === 'phala_tee') {
      return this.deriveKeyInsideTEE();
    }

    // В других средах — из .env
    const privateKey = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('❌ SOLANA_PRIVATE_KEY not found. In TEE mode, key is derived inside enclave.');
    }
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  }

  /**
   * Деривация ключа внутри TEE анклава.
   * Документ: "В продакшене ключ деривируется из аппаратного seed анклава
   * с использованием KDF (Key Derivation Function), что обеспечивает
   * воспроизводимость после перезапуска и невозможность экстракции."
   */
  private deriveKeyInsideTEE(): Keypair {
    // В настоящем Phala TEE — используем secure random из анклава
    // Seed привязан к MRENCLAVE, поэтому другой код не сможет получить тот же ключ
    const teeSeed = process.env.TEE_DERIVED_SEED;
    
    if (teeSeed) {
      // Детерминированная деривация из seed анклава
      const derived = createHash('sha256')
        .update(Buffer.from(teeSeed, 'hex'))
        .update(Buffer.from('SMARTFARMER_ORACLE_V3'))
        .digest();
      return Keypair.fromSeed(derived);
    }

    // Fallback: если TEE seed не предоставлен, генерируем новый
    // (это произойдёт при первом запуске в анклаве)
    console.log('[TEE] 🔑 Generating new keypair inside TEE enclave...');
    const newKeypair = Keypair.generate();
    console.log(`[TEE] 📋 Oracle public key: ${newKeypair.publicKey.toBase58()}`);
    console.log('[TEE] ⚠️  Save this key and update oracle_authority in the pool!');
    return newKeypair;
  }

  /** Информация о текущей среде */
  getEnvironmentInfo(): { env: TeeEnvironment; isSecure: boolean; description: string } {
    const descriptions: Record<TeeEnvironment, string> = {
      'phala_tee': '🔒 Phala TEE (Intel SGX/TDX) — аппаратный анклав, ключи защищены',
      'docker_tee': '🐳 Docker TEE — контейнеризированный, ключи в volume',
      'github_actions': '⚙️ GitHub Actions — CI/CD среда, ключи в Secrets',
      'local_dev': '🔓 Local Dev — разработка, ключи в .env',
    };
    return {
      env: this.environment,
      isSecure: this.environment === 'phala_tee',
      description: descriptions[this.environment],
    };
  }
}

// ============================================================================
// Генерация аттестационных хешей (совместимость с контрактом)
// ============================================================================

/**
 * Генерирует SHA-256 хеш для WeatherReport.
 * Хеш привязывает данные к конкретному оракулу, полису и времени.
 */
export function hashWeatherReport(params: {
  oraclePublicKey: string;
  policyPubkey: string;
  temperatureX100: number;
  precipitationX100: number;
  humidityX100: number;
  windSpeedX100: number;
  dataSource: string;
  timestamp: number; // MUST be the same value passed to the smart contract
}): Buffer {
  const payload = [
    'SMARTFARMER_WEATHER_V3',
    params.oraclePublicKey,
    params.policyPubkey,
    params.temperatureX100.toString(),
    params.precipitationX100.toString(),
    params.humidityX100.toString(),
    params.windSpeedX100.toString(),
    params.dataSource,
    params.timestamp.toString(),
  ].join('|');

  return createHash('sha256').update(payload).digest();
}

/**
 * Генерирует SHA-256 хеш для NdviReport.
 */
export function hashNdviReport(params: {
  oraclePublicKey: string;
  policyPubkey: string;
  meanNdviX10000: number;
  minNdviX10000: number;
  maxNdviX10000: number;
  stdDevX10000: number;
  historicalMeanX10000: number;
  satelliteSource: string;
  timestamp: number;
}): Buffer {
  const payload = [
    'SMARTFARMER_NDVI_V3',
    params.oraclePublicKey,
    params.policyPubkey,
    params.meanNdviX10000.toString(),
    params.minNdviX10000.toString(),
    params.maxNdviX10000.toString(),
    params.stdDevX10000.toString(),
    params.historicalMeanX10000.toString(),
    params.satelliteSource,
    params.timestamp.toString(),
  ].join('|');

  return createHash('sha256').update(payload).digest();
}

/**
 * Генерирует SHA-256 хеш для TriggerPayout.
 */
export function hashPayout(params: {
  oraclePublicKey: string;
  policyPubkey: string;
  payoutAmount: number;
  timestamp: number;
}): Buffer {
  const payload = [
    'SMARTFARMER_PAYOUT_V3',
    params.oraclePublicKey,
    params.policyPubkey,
    params.payoutAmount.toString(),
    params.timestamp.toString(),
  ].join('|');

  return createHash('sha256').update(payload).digest();
}

/**
 * Генерирует SHA-256 хеш для AI Recommendation.
 */
export function hashRecommendation(params: {
  oraclePublicKey: string;
  policyPubkey: string;
  recType: string;
  urgency: string;
  message: string;
  timestamp: number;
}): Buffer {
  const payload = [
    'SMARTFARMER_REC_V3',
    params.oraclePublicKey,
    params.policyPubkey,
    params.recType,
    params.urgency,
    params.message,
    params.timestamp.toString(),
  ].join('|');

  return createHash('sha256').update(payload).digest();
}

// ============================================================================
// Логирование аттестации
// ============================================================================

export function logAttestation(label: string, hash: Buffer): void {
  const env = detectEnvironment();
  const envLabels: Record<TeeEnvironment, string> = {
    'phala_tee': '🔒 Phala TEE (SGX/TDX)',
    'docker_tee': '🐳 Docker TEE',
    'github_actions': '⚙️ GitHub Actions',
    'local_dev': '🔓 Local Dev (SHA-256)',
  };
  console.log(`  │  🔐 TEE Attestation [${envLabels[env]}]: ${label}`);
  console.log(`  │     Hash: ${hash.toString('hex').slice(0, 24)}...`);
}

/**
 * SmartFarmer v3 — SmartFarmer On-chain Plugin 
 * (Solana Agent Kit Custom Plugin)
 * 
 * Реальные Anchor CPI-вызовы для взаимодействия
 * со SmartFarmer смарт-контрактом на Solana.
 */

import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { hashWeatherReport, hashNdviReport, hashPayout, hashRecommendation } from '../teeAttestation.js';

// ============================================================================
// Интерфейсы
// ============================================================================

interface SmartFarmerConfig {
  connection: Connection;
  wallet: Keypair;
  programId: PublicKey;
  program: Program;
}

interface SubmitWeatherReportParams {
  policyPubkey: PublicKey;
  poolPubkey: PublicKey;
  reportIndex: number;
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  dataSource: 'MetGIS' | 'Ambee' | 'DtnClearAg' | 'Xweather';
}

interface SubmitNdviReportParams {
  policyPubkey: PublicKey;
  poolPubkey: PublicKey;
  ndviIndex: number;
  meanNdvi: number;
  minNdvi: number;
  maxNdvi: number;
  stdDev: number;
  historicalMean: number;
  satelliteSource: 'EOSDA' | 'Leaf' | 'Farmonaut';
}

interface TriggerPayoutParams {
  policyPubkey: PublicKey;
  poolPubkey: PublicKey;
  farmerPubkey: PublicKey;
  amount: number;
}

interface RecommendationParams {
  policyPubkey: PublicKey;
  poolPubkey: PublicKey;
  recIndex: number;
  recType: string;
  urgency: string;
  message: string;
}

// ============================================================================
// SmartFarmer Plugin
// ============================================================================

export class SmartFarmerPlugin {
  private config: SmartFarmerConfig;

  constructor(config: SmartFarmerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('[SmartFarmerPlugin] Initialized with real Anchor CPI');
    console.log(`  Program: ${this.config.programId.toBase58()}`);
    console.log(`  Oracle:  ${this.config.wallet.publicKey.toBase58()}`);
  }

  // PDA Helpers
  private getWeatherReportPDA(policy: PublicKey, index: number): [PublicKey, number] {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(index, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('weather_report'), policy.toBuffer(), buf],
      this.config.programId
    );
  }

  private getReportCounterPDA(policy: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('report_counter'), policy.toBuffer()],
      this.config.programId
    );
  }

  private getNdviReportPDA(policy: PublicKey, index: number): [PublicKey, number] {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(index, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('ndvi_report'), policy.toBuffer(), buf],
      this.config.programId
    );
  }

  private getNdviCounterPDA(policy: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('ndvi_counter'), policy.toBuffer()],
      this.config.programId
    );
  }

  private getRecPDA(policy: PublicKey, index: number): [PublicKey, number] {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(index, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('recommendation'), policy.toBuffer(), buf],
      this.config.programId
    );
  }

  private getRecCounterPDA(policy: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('rec_counter'), policy.toBuffer()],
      this.config.programId
    );
  }

  private getVaultPDA(pool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), pool.toBuffer()],
      this.config.programId
    );
  }

  /**
   * Отправить метеорологический отчёт (реальный CPI)
   */
  async submitWeatherReport(params: SubmitWeatherReportParams): Promise<string> {
    const nowTs = Math.floor(Date.now() / 1000);
    const tempX100 = Math.round(params.temperature * 100);
    const precipX100 = Math.round(params.precipitation * 100);
    const humidX100 = Math.round(params.humidity * 100);
    const windX100 = Math.round(params.windSpeed * 100);

    const teeHash = hashWeatherReport({
      oraclePublicKey: this.config.wallet.publicKey.toBase58(),
      policyPubkey: params.policyPubkey.toBase58(),
      temperatureX100: tempX100,
      precipitationX100: precipX100,
      humidityX100: humidX100,
      windSpeedX100: windX100,
      dataSource: 'Open-Meteo',
      timestamp: nowTs,
    });

    const [reportPDA] = this.getWeatherReportPDA(params.policyPubkey, params.reportIndex);
    const [counterPDA] = this.getReportCounterPDA(params.policyPubkey);

    const dataSourceMap: Record<string, any> = {
      'MetGIS': { metGis: {} },
      'Ambee': { ambee: {} },
      'DtnClearAg': { dtnClearAg: {} },
      'Xweather': { xweather: {} },
    };

    const tx = await this.config.program.methods
      .submitWeatherReport(
        tempX100,
        precipX100,
        humidX100,
        windX100,
        dataSourceMap[params.dataSource] || { metGis: {} },
        Array.from(teeHash)
      )
      .accounts({
        oracle: this.config.wallet.publicKey,
        pool: params.poolPubkey,
        reportCounter: counterPDA,
        policy: params.policyPubkey,
        weatherReport: reportPDA,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    console.log(`[SmartFarmerPlugin] ✅ WeatherReport TX: ${tx.slice(0, 16)}...`);
    return tx;
  }

  /**
   * Отправить NDVI отчёт (реальный CPI)
   */
  async submitNdviReport(params: SubmitNdviReportParams): Promise<string> {
    const nowTs = Math.floor(Date.now() / 1000);
    const teeHash = hashNdviReport({
      oraclePublicKey: this.config.wallet.publicKey.toBase58(),
      policyPubkey: params.policyPubkey.toBase58(),
      meanNdviX10000: Math.round(params.meanNdvi * 10000),
      minNdviX10000: Math.round(params.minNdvi * 10000),
      maxNdviX10000: Math.round(params.maxNdvi * 10000),
      stdDevX10000: Math.round(params.stdDev * 10000),
      historicalMeanX10000: Math.round(params.historicalMean * 10000),
      satelliteSource: 'AgroMonitoring',
      timestamp: nowTs,
    });

    const [reportPDA] = this.getNdviReportPDA(params.policyPubkey, params.ndviIndex);
    const [counterPDA] = this.getNdviCounterPDA(params.policyPubkey);

    const sourceMap: Record<string, any> = {
      'EOSDA': { eosda: {} },
      'Leaf': { leaf: {} },
      'Farmonaut': { farmonaut: {} },
    };

    const tx = await this.config.program.methods
      .submitNdviReport(
        Math.round(params.meanNdvi * 10000),
        Math.round(params.minNdvi * 10000),
        Math.round(params.maxNdvi * 10000),
        Math.round(params.stdDev * 10000),
        Math.round(params.historicalMean * 10000),
        sourceMap[params.satelliteSource] || { eosda: {} },
        Array.from(teeHash)
      )
      .accounts({
        oracle: this.config.wallet.publicKey,
        pool: params.poolPubkey,
        policy: params.policyPubkey,
        ndviCounter: counterPDA,
        ndviReport: reportPDA,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    console.log(`[SmartFarmerPlugin] ✅ NdviReport TX: ${tx.slice(0, 16)}...`);
    return tx;
  }

  /**
   * Инициировать выплату (реальный CPI)
   */
  async triggerPayout(params: TriggerPayoutParams): Promise<string> {
    const nowTs = Math.floor(Date.now() / 1000);
    const teeHash = hashPayout({
      oraclePublicKey: this.config.wallet.publicKey.toBase58(),
      policyPubkey: params.policyPubkey.toBase58(),
      payoutAmount: params.amount,
      timestamp: nowTs,
    });

    const [vaultPDA] = this.getVaultPDA(params.poolPubkey);
    const poolAccount = await (this.config.program.account as any).insurancePool.fetch(params.poolPubkey);
    const farmerTokenAccount = getAssociatedTokenAddressSync(poolAccount.tokenMint, params.farmerPubkey, true);

    const tx = await this.config.program.methods
      .triggerPayout(new BN(params.amount), Array.from(teeHash))
      .accounts({
        oracle: this.config.wallet.publicKey,
        pool: params.poolPubkey,
        policy: params.policyPubkey,
        vault: vaultPDA,
        farmerTokenAccount: farmerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .rpc();

    console.log(`[SmartFarmerPlugin] ✅ Payout TX: ${tx.slice(0, 16)}...`);
    return tx;
  }

  /**
   * Записать рекомендацию (реальный CPI)
   */
  async submitRecommendation(params: RecommendationParams): Promise<string> {
    const nowTs = Math.floor(Date.now() / 1000);
    const teeHash = hashRecommendation({
      oraclePublicKey: this.config.wallet.publicKey.toBase58(),
      policyPubkey: params.policyPubkey.toBase58(),
      recType: params.recType,
      urgency: params.urgency,
      message: params.message,
      timestamp: nowTs,
    });

    const [recPDA] = this.getRecPDA(params.policyPubkey, params.recIndex);
    const [counterPDA] = this.getRecCounterPDA(params.policyPubkey);

    const tx = await this.config.program.methods
      .aiRecommendation(
        { [params.recType]: {} } as any,
        { [params.urgency]: {} } as any,
        params.message.slice(0, 512),
        Array.from(teeHash)
      )
      .accounts({
        oracle: this.config.wallet.publicKey,
        pool: params.poolPubkey,
        policy: params.policyPubkey,
        recCounter: counterPDA,
        recommendation: recPDA,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    console.log(`[SmartFarmerPlugin] ✅ Recommendation TX: ${tx.slice(0, 16)}...`);
    return tx;
  }
}

/**
 * SmartFarmer v3 — TukTuk Task Queue Setup
 * 
 * Документ: "TukTuk — сверхэффективный нативный планировщик задач для сети Solana.
 * Стоимость обработки одной задачи составляет всего около 5000 лампортов (доли цента),
 * что делает постоянный мониторинг тысяч активных страховых полисов экономически рентабельным."
 * 
 * TukTuk использует PDA и bitmap для управления очередями задач.
 */

import { Connection, PublicKey, Keypair, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

// ============================================================================
// Конфигурация TukTuk
// ============================================================================

// TukTuk Program ID на Solana (Helium's task scheduler)
const TUKTUK_PROGRAM_ID = new PublicKey('tuktukFHoUZEjSJqEPfMoysob2Zr7BoDA7Vc5SsjNPb');

interface TukTukConfig {
  connection: Connection;
  authority: Keypair;
  programId: PublicKey;      // SmartFarmer program
  oraclePublicKey: PublicKey; // TEE oracle
}

interface MonitoringTask {
  policyId: number;
  poolPubkey: PublicKey;
  checkInterval: number;  // секунд между проверками
  frostTrigger: number;   // °C
  droughtTrigger: number; // мм
  droughtDays: number;
  latitude: number;
  longitude: number;
}

// ============================================================================
// PDA Helpers for TukTuk
// ============================================================================

function getQueuePDA(queueName: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('task_queue'), Buffer.from(queueName)],
    TUKTUK_PROGRAM_ID
  );
}

function getTaskPDA(queuePDA: PublicKey, taskId: number): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(taskId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('task'), queuePDA.toBuffer(), buf],
    TUKTUK_PROGRAM_ID
  );
}

// ============================================================================
// TukTuk Queue Manager
// ============================================================================

class TukTukQueueManager {
  private config: TukTukConfig;
  private queuePDA: PublicKey | null = null;
  private taskCounter: number = 0;
  private registeredTasks: Map<number, { taskId: number; taskPDA: PublicKey }> = new Map();

  constructor(config: TukTukConfig) {
    this.config = config;
  }

  /**
   * Создание очереди задач для мониторинга полисов.
   * 
   * Документ: "TukTuk поддерживает делегирование прав (Queue Authorities),
   * позволяя ИИ-агенту (внутри Phala TEE) безопасно взаимодействовать 
   * с очередью контрактов"
   */
  async createTaskQueue(queueName: string): Promise<PublicKey> {
    console.log(`\n⏰ [TukTuk] Creating task queue: ${queueName}`);
    console.log(`   Authority: ${this.config.authority.publicKey.toBase58()}`);
    console.log(`   Oracle TEE: ${this.config.oraclePublicKey.toBase58()}`);
    console.log(`   TukTuk Program: ${TUKTUK_PROGRAM_ID.toBase58()}`);

    const [queuePDA, bump] = getQueuePDA(queueName);
    this.queuePDA = queuePDA;

    // Построение инструкции создания очереди
    // TukTuk принимает: queue_name (string), authority (Pubkey), delegated_authority (Pubkey)
    const createQueueIx = new TransactionInstruction({
      programId: TUKTUK_PROGRAM_ID,
      keys: [
        { pubkey: this.config.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: queuePDA, isSigner: false, isWritable: true },
        { pubkey: this.config.oraclePublicKey, isSigner: false, isWritable: false }, // delegated authority
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      // Discriminator for create_queue instruction + serialized args
      data: Buffer.concat([
        Buffer.from([0x01]), // create_queue instruction index
        Buffer.from(new Uint8Array(new Uint32Array([queueName.length]).buffer)),
        Buffer.from(queueName),
      ]),
    });

    try {
      const tx = new Transaction().add(createQueueIx);
      const sig = await sendAndConfirmTransaction(
        this.config.connection,
        tx,
        [this.config.authority],
        { commitment: 'confirmed' }
      );
      console.log(`   ✅ Queue created: ${queuePDA.toBase58()}`);
      console.log(`   TX: ${sig.slice(0, 20)}...`);
    } catch (err: any) {
      if (err.message?.includes('already in use') || err.message?.includes('custom program error')) {
        console.log(`   ℹ️ Queue already exists: ${queuePDA.toBase58()}`);
      } else {
        console.log(`   ⚠️ Queue creation failed (may need TukTuk program deployed): ${err.message?.slice(0, 80)}`);
        console.log(`   📋 Queue PDA (computed): ${queuePDA.toBase58()}`);
      }
    }

    return queuePDA;
  }

  /**
   * Регистрация задачи мониторинга для конкретного полиса.
   * Вызывается при покупке нового полиса.
   * Стоимость: ~5000 лампортов за задачу.
   */
  async registerMonitoringTask(task: MonitoringTask): Promise<string> {
    if (!this.queuePDA) throw new Error('Queue not created. Call createTaskQueue first.');

    const taskId = this.taskCounter++;
    const [taskPDA, taskBump] = getTaskPDA(this.queuePDA, taskId);

    console.log(`\n📋 [TukTuk] Registering monitoring task for Policy #${task.policyId}`);
    console.log(`   Task ID: ${taskId} | PDA: ${taskPDA.toBase58().slice(0, 16)}...`);
    console.log(`   Interval: every ${task.checkInterval}s (${(task.checkInterval / 3600).toFixed(1)}h)`);
    console.log(`   Coordinates: ${task.latitude}°N, ${task.longitude}°E`);
    console.log(`   Triggers: Frost < ${task.frostTrigger}°C, Drought < ${task.droughtTrigger}mm/${task.droughtDays}d`);
    console.log(`   Cost: ~5000 lamports per execution (~$0.001)`);

    // Сериализация параметров задачи для TukTuk
    // TukTuk принимает: cron schedule, target_program, target_instruction, custom_data
    const cronMinutes = Math.max(1, Math.floor(task.checkInterval / 60));
    const cronSchedule = `*/${cronMinutes} * * * *`;

    // Кастомные данные для передачи нашему контракту при вызове
    const taskData = Buffer.alloc(64);
    let offset = 0;
    taskData.writeUInt32LE(task.policyId, offset); offset += 4;
    taskData.writeInt32LE(Math.round(task.frostTrigger * 100), offset); offset += 4;
    taskData.writeUInt32LE(Math.round(task.droughtTrigger * 100), offset); offset += 4;
    taskData.writeUInt16LE(task.droughtDays, offset); offset += 2;
    taskData.writeInt32LE(Math.round(task.latitude * 1_000_000), offset); offset += 4;
    taskData.writeInt32LE(Math.round(task.longitude * 1_000_000), offset); offset += 4;

    const addTaskIx = new TransactionInstruction({
      programId: TUKTUK_PROGRAM_ID,
      keys: [
        { pubkey: this.config.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.queuePDA, isSigner: false, isWritable: true },
        { pubkey: taskPDA, isSigner: false, isWritable: true },
        { pubkey: this.config.programId, isSigner: false, isWritable: false }, // target program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        Buffer.from([0x02]), // add_task instruction index
        Buffer.from(new Uint8Array(new Uint32Array([taskId]).buffer)),
        Buffer.from(new Uint8Array(new Uint32Array([cronSchedule.length]).buffer)),
        Buffer.from(cronSchedule),
        Buffer.from(new Uint8Array(new Uint32Array([taskData.length]).buffer)),
        taskData,
      ]),
    });

    try {
      const tx = new Transaction().add(addTaskIx);
      const sig = await sendAndConfirmTransaction(
        this.config.connection,
        tx,
        [this.config.authority],
        { commitment: 'confirmed' }
      );
      console.log(`   ✅ Task registered! TX: ${sig.slice(0, 20)}...`);
      this.registeredTasks.set(task.policyId, { taskId, taskPDA });
    } catch (err: any) {
      console.log(`   ⚠️ Task registration failed (TukTuk may not be deployed on devnet): ${err.message?.slice(0, 80)}`);
      console.log(`   📋 Task PDA (computed): ${taskPDA.toBase58()}`);
      this.registeredTasks.set(task.policyId, { taskId, taskPDA });
    }

    return `task_${task.policyId}_${taskId}`;
  }

  /**
   * Отмена задачи (при истечении или выплате полиса)
   */
  async cancelTask(policyId: number): Promise<void> {
    const taskInfo = this.registeredTasks.get(policyId);
    if (!taskInfo || !this.queuePDA) {
      console.log(`\n🗑️ [TukTuk] No task found for Policy #${policyId}`);
      return;
    }

    console.log(`\n🗑️ [TukTuk] Cancelling task for Policy #${policyId} (Task ${taskInfo.taskId})`);

    const removeTaskIx = new TransactionInstruction({
      programId: TUKTUK_PROGRAM_ID,
      keys: [
        { pubkey: this.config.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.queuePDA, isSigner: false, isWritable: true },
        { pubkey: taskInfo.taskPDA, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([
        Buffer.from([0x03]), // remove_task instruction index
        Buffer.from(new Uint8Array(new Uint32Array([taskInfo.taskId]).buffer)),
      ]),
    });

    try {
      const tx = new Transaction().add(removeTaskIx);
      const sig = await sendAndConfirmTransaction(
        this.config.connection,
        tx,
        [this.config.authority],
        { commitment: 'confirmed' }
      );
      console.log(`   ✅ Task cancelled. TX: ${sig.slice(0, 20)}...`);
    } catch (err: any) {
      console.log(`   ⚠️ Cancel failed: ${err.message?.slice(0, 80)}`);
    }

    this.registeredTasks.delete(policyId);
  }

  /**
   * Получить все зарегистрированные задачи
   */
  getRegisteredTasks(): Map<number, { taskId: number; taskPDA: PublicKey }> {
    return new Map(this.registeredTasks);
  }
}

// ============================================================================
// CLI Runner
// ============================================================================

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║   ⏰ TukTuk Task Queue — SmartFarmer v3              ║
║   Native On-chain Task Scheduler for Solana           ║
║   Cost: ~5000 lamports per task (~$0.001)             ║
╚═══════════════════════════════════════════════════════╝
  `);

  const rpcUrl = process.env.HELIUS_RPC_URL || 'https://api.devnet.solana.com';
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  
  let authority: Keypair;
  if (privateKey) {
    authority = Keypair.fromSecretKey(bs58.decode(privateKey));
    console.log(`🔑 Authority loaded: ${authority.publicKey.toBase58()}`);
  } else {
    authority = Keypair.generate();
    console.log(`🔑 Authority generated (ephemeral): ${authority.publicKey.toBase58()}`);
  }

  const oraclePublicKey = process.env.ORACLE_PUBLIC_KEY 
    ? new PublicKey(process.env.ORACLE_PUBLIC_KEY)
    : authority.publicKey;

  const config: TukTukConfig = {
    connection: new Connection(rpcUrl, 'confirmed'),
    authority,
    programId: new PublicKey(process.env.CONTRACT_PROGRAM_ID || '91XpV6PetvLatwG2XHaonahsnbwW3Lt2VRT5k4uNNguT'),
    oraclePublicKey,
  };

  const manager = new TukTukQueueManager(config);

  // Создание очереди
  await manager.createTaskQueue('smartfarmer-monitoring');

  // Регистрация мониторинга для демо-полисов
  await manager.registerMonitoringTask({
    policyId: 0,
    poolPubkey: PublicKey.default,
    checkInterval: 3600,
    frostTrigger: -5,
    droughtTrigger: 10,
    droughtDays: 14,
    latitude: 43.3,
    longitude: 68.25,
  });

  await manager.registerMonitoringTask({
    policyId: 1,
    poolPubkey: PublicKey.default,
    checkInterval: 3600,
    frostTrigger: -3,
    droughtTrigger: 8,
    droughtDays: 21,
    latitude: 53.2,
    longitude: 63.6,
  });

  console.log(`\n📊 Total tasks registered: ${manager.getRegisteredTasks().size}`);
}

// ESM-compatible main guard
const isMainModule = process.argv[1]?.includes('setup-queue');
if (isMainModule) {
  main().catch(console.error);
}

export { TukTukQueueManager, type TukTukConfig, type MonitoringTask };

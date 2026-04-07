// @ts-nocheck
/**
 * SmartFarmer v3 — Dual-Channel Notification System (Dialect + Telegram)
 * 
 * Интеграция Dialect SDK для Web3-уведомлений и Telegram API для Web2.5.
 */
import { Dialect, DialectCloudEnvironment, DialectSdk, Environment } from '@dialectlabs/sdk';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export type NotificationType = 
  | 'frost_alert'
  | 'drought_alert'
  | 'ndvi_alert'
  | 'payout_initiated'
  | 'payout_completed'
  | 'recommendation'
  | 'policy_expired';

export interface TelegramNotification {
  type: NotificationType;
  recipientWallet: string; // В реальном проде здесь нужен маппинг Wallet -> Telegram Chat ID (или мы броадкастим в канал)
  title: string;
  message: string;
  policyId: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class TelegramNotificationService {
  private botToken: string;
  private defaultChatId: string; // Канал или чат для алертов (в рамках демо/хакатона)
  private enabled: boolean;
  private dialectEnabled: boolean;
  private dialectSdk: DialectSdk | null = null;
  private notificationLog: TelegramNotification[] = [];

  constructor(enabled: boolean = false) {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.defaultChatId = process.env.TELEGRAM_CHAT_ID || '';
    
    this.enabled = enabled && !!this.botToken && !!this.defaultChatId;
    this.dialectEnabled = process.env.DIALECT_ENABLED === 'true';
    
    if (this.enabled) {
      console.log(`[Telegram] LIVE Notification Service initialized`);
    } else {
      console.log(`[Telegram] LOG Mode initialized (token or chatId missing)`);
    }

    if (this.dialectEnabled) {
      this.initDialect();
    }
  }

  private initDialect() {
    try {
      const oracleKey = process.env.SOLANA_PRIVATE_KEY;
      if (!oracleKey) throw new Error("No SOLANA_PRIVATE_KEY for Dialect");
      
      const keypair = Keypair.fromSecretKey(bs58.decode(oracleKey));
      
      const environment: Environment = 'production';
      const dialectCloudEnvironment: DialectCloudEnvironment = 'production';
      
      // Инициализация Dialect SDK
      this.dialectSdk = Dialect.sdk({
        environment,
        dialectCloud: { environment: dialectCloudEnvironment },
        wallet: {
          publicKey: keypair.publicKey,
          signMessage: async (msg) => {
            const nacl = require('tweetnacl');
            return nacl.sign.detached(msg, keypair.secretKey);
          },
          signTransaction: async (tx) => tx, // не нужно для базовых push-алертов
        },
      });
      console.log('[Dialect] Web3 Messaging initialized');
    } catch (e: any) {
      console.error(`[Dialect] Init failed: ${e.message}`);
      this.dialectEnabled = false;
    }
  }

  /**
   * Отправить уведомление о заморозке
   */
  async sendFrostAlert(
    farmerWallet: string,
    policyId: number,
    temperature: number,
    threshold: number,
  ): Promise<void> {
    const notification: TelegramNotification = {
      type: 'frost_alert',
      recipientWallet: farmerWallet,
      title: '🥶 Заморозки обнаружены!',
      message: `<b>SmartFarmer</b>: Температура <b>${temperature}°C</b> ниже порога ${threshold}°C.\n` +
        `Полис <b>#${policyId}</b> активирован. Рекомендуем провести превентивный полив.\n` +
        `Ожидаем спутниковую верификацию NDVI.`,
      policyId,
      timestamp: Date.now(),
      metadata: { temperature, threshold },
    };

    await this.dispatch(notification);
  }

  /**
   * Отправить уведомление о засухе
   */
  async sendDroughtAlert(
    farmerWallet: string,
    policyId: number,
    precipitation: number,
    threshold: number,
    periodDays: number,
  ): Promise<void> {
    const notification: TelegramNotification = {
      type: 'drought_alert',
      recipientWallet: farmerWallet,
      title: '☀️ Засуха зафиксирована!',
      message: `<b>SmartFarmer</b>: Осадки <b>${precipitation}мм</b> за ${periodDays} дней — ниже порога ${threshold}мм.\n` +
        `Полис <b>#${policyId}</b> активирован. Увеличьте объём ирригации.`,
      policyId,
      timestamp: Date.now(),
      metadata: { precipitation, threshold, periodDays },
    };

    await this.dispatch(notification);
  }

  /**
   * Уведомление о подтверждении NDVI
   */
  async sendNdviConfirmation(
    farmerWallet: string,
    policyId: number,
    ndviDelta: number,
  ): Promise<void> {
    const notification: TelegramNotification = {
      type: 'ndvi_alert',
      recipientWallet: farmerWallet,
      title: '🛰️ Спутник подтвердил ущерб',
      message: `<b>SmartFarmer</b>: NDVI упал на <b>${Math.abs(ndviDelta).toFixed(1)}%</b> по данным Sentinel-2.\n` +
        `Биологический ущерб посевам подтверждён. Автовыплата по полису <b>#${policyId}</b> инициирована.`,
      policyId,
      timestamp: Date.now(),
      metadata: { ndviDelta },
    };

    await this.dispatch(notification);
  }

  /**
   * Уведомление об успешной выплате
   */
  async sendPayoutNotification(
    farmerWallet: string,
    policyId: number,
    amount: number,
    txSignature?: string,
  ): Promise<void> {
    const notification: TelegramNotification = {
      type: 'payout_completed',
      recipientWallet: farmerWallet,
      title: '💰 Компенсация выплачена!',
      message: `<b>SmartFarmer</b>: Выплата <b>${amount}</b> токенов по полису #${policyId} выполнена успешно!\n` +
        (txSignature ? `<i>Tx:</i> <a href="https://explorer.solana.com/tx/${txSignature}?cluster=devnet">Посмотреть в Explorer</a>` : ''),
      policyId,
      timestamp: Date.now(),
      metadata: { amount, txSignature },
    };

    await this.dispatch(notification);
  }

  /**
   * Уведомление с агрономической рекомендацией
   */
  async sendRecommendation(
    farmerWallet: string,
    policyId: number,
    urgency: string,
    message: string,
  ): Promise<void> {
    const urgencyIcon = urgency === 'critical' ? '🚨' : urgency === 'high' ? '⚠️' : 'ℹ️';
    
    const notification: TelegramNotification = {
      type: 'recommendation',
      recipientWallet: farmerWallet,
      title: `${urgencyIcon} Рекомендация агронома`,
      message: `<b>SmartFarmer AI</b>: ${message}`,
      policyId,
      timestamp: Date.now(),
      metadata: { urgency },
    };

    await this.dispatch(notification);
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private async dispatch(notification: TelegramNotification): Promise<void> {
    this.notificationLog.push(notification);
    
    // Формируем красивый текст
    const textToSend = `<b>${notification.title}</b>\n\n${notification.message}\n\n<code>👛 ${notification.recipientWallet.slice(0,4)}...${notification.recipientWallet.slice(-4)}</code>`;

    if (this.enabled) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: this.defaultChatId,
            text: textToSend,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }),
        });
        
        if (!response.ok) {
           throw new Error(`Telegram API responded with status ${response.status}`);
        }
        console.log(`  │  📨 [Telegram Sender] → Уведомление отправлено`);
      } catch (err: any) {
        console.error(`  │  ❌ [Telegram Sender] Send failed: ${err.message}`);
      }
    } else {
      console.log(`  │  📨 [Telegram LOG] ${notification.title}`);
      console.log(`  │     → ${notification.recipientWallet.slice(0, 12)}... | ${notification.message.slice(0, 80).replace(/\n/g, ' ')}...`);
    }

    // Dual-channel: также отправляем по Web3 Dialect 
    if (this.dialectEnabled && this.dialectSdk) {
      this.sendDialect(notification);
    }
  }

  private async sendDialect(notification: TelegramNotification) {
    try {
      // Ищем тред с фермером
      const threads = await this.dialectSdk!.threads.findAll();
      let thread = threads.find(t => 
        t.me.publicKey.toBase58() === notification.recipientWallet ||
        t.otherMembers.some(m => m.publicKey.toBase58() === notification.recipientWallet)
      );
      
      if (thread) {
        await thread.send({
          text: `${notification.title}\n${notification.message}`.replace(/<[^>]+>/g, ''), // Убираем HTML-теги для Dialect
        });
        console.log(`  │  📨 [Dialect Web3] → Сообщение доставлено на кошелек фермера`);
      } else {
        console.log(`  │  📨 [Dialect Web3] Фермер ${notification.recipientWallet} еще не подписан в Dialect. Отправка пропущена.`);
      }
    } catch (e: any) {
      console.error(`  │  ❌ [Dialect Web3] Send failed: ${e.message}`);
    }
  }

  getNotificationLog(): TelegramNotification[] {
    return [...this.notificationLog];
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const n of this.notificationLog) {
      byType[n.type] = (byType[n.type] || 0) + 1;
    }
    return { total: this.notificationLog.length, byType };
  }
}

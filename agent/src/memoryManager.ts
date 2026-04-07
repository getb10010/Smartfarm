/**
 * SmartFarmer v3 — Memory Manager (RAG-подобная система)
 * 
 * In-memory хранилище для контекстных рекомендаций ИИ-агронома.
 * Сохраняет историю метеоданных, NDVI и решений по каждому полису,
 * позволяя агенту учитывать тренды при формировании рекомендаций.
 * 
 * Документ: "ElizaOS автоматически берет на себя управление памятью 
 * (Memory Management): система сохраняет весь контекст предыдущих 
 * взаимодействий в базы данных и использует архитектуру RAG"
 */

import { WeatherData } from './plugins/weatherPlugin.js';
import { NdviStatistics } from './plugins/satellitePlugin.js';

// ============================================================================
// Типы записей памяти
// ============================================================================

export interface WeatherMemoryRecord {
  timestamp: number;
  policyId: number;
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  frostTriggered: boolean;
  droughtTriggered: boolean;
}

export interface NdviMemoryRecord {
  timestamp: number;
  policyId: number;
  meanNdvi: number;
  deltaPercent: number;
  ndviTriggered: boolean;
}

export interface DecisionMemoryRecord {
  timestamp: number;
  policyId: number;
  action: 'payout' | 'no_payout' | 'awaiting_ndvi';
  amount: number;
  reason: string;
}

export interface RecommendationMemoryRecord {
  timestamp: number;
  policyId: number;
  type: string;
  urgency: string;
  message: string;
}

export interface PolicyContext {
  weather: WeatherMemoryRecord[];
  ndvi: NdviMemoryRecord[];
  decisions: DecisionMemoryRecord[];
  recommendations: RecommendationMemoryRecord[];
}

// ============================================================================
// Memory Manager
// ============================================================================

const MAX_RECORDS_PER_TYPE = 168; // 7 дней × 24 часа

export class MemoryManager {
  private memory: Map<number, PolicyContext> = new Map();
  private characterKnowledge: string[] = [];

  constructor() {
    console.log('[MemoryManager] Initialized — in-memory RAG context store');
  }

  /**
   * Загрузка knowledge из ElizaOS Character File
   */
  loadCharacterKnowledge(knowledge: string[]): void {
    this.characterKnowledge = knowledge;
    console.log(`[MemoryManager] Loaded ${knowledge.length} knowledge items from Character File`);
  }

  /**
   * Получить или создать контекст полиса
   */
  private getContext(policyId: number): PolicyContext {
    if (!this.memory.has(policyId)) {
      this.memory.set(policyId, {
        weather: [],
        ndvi: [],
        decisions: [],
        recommendations: [],
      });
    }
    return this.memory.get(policyId)!;
  }

  /**
   * Записать метеоданные
   */
  addWeatherRecord(policyId: number, record: Omit<WeatherMemoryRecord, 'timestamp'>): void {
    const ctx = this.getContext(policyId);
    ctx.weather.push({ ...record, timestamp: Date.now() });
    if (ctx.weather.length > MAX_RECORDS_PER_TYPE) {
      ctx.weather = ctx.weather.slice(-MAX_RECORDS_PER_TYPE);
    }
  }

  /**
   * Записать NDVI
   */
  addNdviRecord(policyId: number, record: Omit<NdviMemoryRecord, 'timestamp'>): void {
    const ctx = this.getContext(policyId);
    ctx.ndvi.push({ ...record, timestamp: Date.now() });
    if (ctx.ndvi.length > MAX_RECORDS_PER_TYPE) {
      ctx.ndvi = ctx.ndvi.slice(-MAX_RECORDS_PER_TYPE);
    }
  }

  /**
   * Записать решение
   */
  addDecision(policyId: number, record: Omit<DecisionMemoryRecord, 'timestamp'>): void {
    const ctx = this.getContext(policyId);
    ctx.decisions.push({ ...record, timestamp: Date.now() });
    if (ctx.decisions.length > MAX_RECORDS_PER_TYPE) {
      ctx.decisions = ctx.decisions.slice(-MAX_RECORDS_PER_TYPE);
    }
  }

  /**
   * Записать рекомендацию
   */
  addRecommendation(policyId: number, record: Omit<RecommendationMemoryRecord, 'timestamp'>): void {
    const ctx = this.getContext(policyId);
    ctx.recommendations.push({ ...record, timestamp: Date.now() });
    if (ctx.recommendations.length > MAX_RECORDS_PER_TYPE) {
      ctx.recommendations = ctx.recommendations.slice(-MAX_RECORDS_PER_TYPE);
    }
  }

  /**
   * Получить историю погоды (последние N записей)
   */
  getWeatherHistory(policyId: number, count: number = 24): WeatherMemoryRecord[] {
    const ctx = this.getContext(policyId);
    return ctx.weather.slice(-count);
  }

  /**
   * Получить историю NDVI
   */
  getNdviHistory(policyId: number, count: number = 10): NdviMemoryRecord[] {
    const ctx = this.getContext(policyId);
    return ctx.ndvi.slice(-count);
  }

  /**
   * Анализировать температурный тренд за последние N циклов
   */
  getTemperatureTrend(policyId: number, cycles: number = 6): {
    trend: 'cooling' | 'warming' | 'stable';
    avgTemp: number;
    minTemp: number;
    maxTemp: number;
    frostCount: number;
  } {
    const history = this.getWeatherHistory(policyId, cycles);
    if (history.length < 2) {
      return { trend: 'stable', avgTemp: 0, minTemp: 0, maxTemp: 0, frostCount: 0 };
    }

    const temps = history.map(r => r.temperature);
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const frostCount = history.filter(r => r.frostTriggered).length;

    // Simple linear trend
    const firstHalf = temps.slice(0, Math.floor(temps.length / 2));
    const secondHalf = temps.slice(Math.floor(temps.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const delta = secondAvg - firstAvg;

    let trend: 'cooling' | 'warming' | 'stable';
    if (delta < -1.5) trend = 'cooling';
    else if (delta > 1.5) trend = 'warming';
    else trend = 'stable';

    return { trend, avgTemp, minTemp, maxTemp, frostCount };
  }

  /**
   * Анализировать тренд NDVI
   */
  getNdviTrend(policyId: number, cycles: number = 5): {
    trend: 'declining' | 'improving' | 'stable';
    avgNdvi: number;
    triggerCount: number;
  } {
    const history = this.getNdviHistory(policyId, cycles);
    if (history.length < 2) {
      return { trend: 'stable', avgNdvi: 0, triggerCount: 0 };
    }

    const ndvis = history.map(r => r.meanNdvi);
    const avgNdvi = ndvis.reduce((a, b) => a + b, 0) / ndvis.length;
    const triggerCount = history.filter(r => r.ndviTriggered).length;

    const firstHalf = ndvis.slice(0, Math.floor(ndvis.length / 2));
    const secondHalf = ndvis.slice(Math.floor(ndvis.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const delta = secondAvg - firstAvg;

    let trend: 'declining' | 'improving' | 'stable';
    if (delta < -0.05) trend = 'declining';
    else if (delta > 0.05) trend = 'improving';
    else trend = 'stable';

    return { trend, avgNdvi, triggerCount };
  }

  /**
   * Контекстная рекомендация с учётом трендов и knowledge
   */
  getContextualAdvice(policyId: number, cropType: string): string {
    const tempTrend = this.getTemperatureTrend(policyId);
    const ndviTrend = this.getNdviTrend(policyId);

    const parts: string[] = [];

    // Тренд-анализ
    if (tempTrend.trend === 'cooling') {
      parts.push(`📉 Тренд: температура снижается (среднее ${tempTrend.avgTemp.toFixed(1)}°C, мин ${tempTrend.minTemp.toFixed(1)}°C).`);
    }
    if (tempTrend.frostCount > 0) {
      parts.push(`⚠️ За последние циклы зафиксировано ${tempTrend.frostCount} заморозков.`);
    }
    if (ndviTrend.trend === 'declining') {
      parts.push(`📉 NDVI снижается (ср. ${ndviTrend.avgNdvi.toFixed(2)}), рекомендована проверка посевов.`);
    }

    // Поиск по knowledge (RAG-подобный)
    const cropLower = cropType.toLowerCase();
    const relevantKnowledge = this.characterKnowledge.filter(k =>
      k.toLowerCase().includes(cropLower) ||
      k.toLowerCase().includes('ndvi') ||
      k.toLowerCase().includes('заморозк') ||
      k.toLowerCase().includes('засух')
    );
    if (relevantKnowledge.length > 0) {
      parts.push(`📚 Справка: ${relevantKnowledge[0]}`);
    }

    return parts.length > 0
      ? parts.join(' ')
      : `✅ Данных для контекстного анализа пока недостаточно. Мониторинг ${cropType} продолжается.`;
  }

  /**
   * Статистика использования памяти
   */
  getStats(): { totalPolicies: number; totalRecords: number } {
    let totalRecords = 0;
    for (const [, ctx] of this.memory) {
      totalRecords += ctx.weather.length + ctx.ndvi.length + ctx.decisions.length + ctx.recommendations.length;
    }
    return { totalPolicies: this.memory.size, totalRecords };
  }
}

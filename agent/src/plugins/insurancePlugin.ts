/**
 * SmartFarmer v3 — Insurance Logic Plugin
 * 
 * Бизнес-логика параметрического страхования:
 * - Оценка рисков (андеррайтинг)
 * - Расчёт справедливой премии
 * - Определение суммы выплаты
 * - Генерация агрономических рекомендаций
 */

import { TriggerEvaluation } from './weatherPlugin.js';
import { NdviTriggerResult } from './satellitePlugin.js';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';

// ============================================================================
// Интерфейсы
// ============================================================================

export interface PolicyParams {
  cropType: string;
  areaHectares: number;
  frostTriggerTemp: number;     // °C
  droughtTriggerPrecip: number; // мм
  droughtPeriodDays: number;
  ndviDropThreshold: number;    // % (например 40)
  coverageAmount: number;       // в USDC
  premiumAmount: number;        // в USDC
}

export interface PayoutDecision {
  shouldPayout: boolean;
  amount: number;
  reason: string;
  weatherEvidence: TriggerEvaluation;
  ndviEvidence: NdviTriggerResult | null;
  confidenceScore: number; // 0-1
}

export interface AgronomicRecommendation {
  type: 'irrigation' | 'frost_warning' | 'drought_warning' | 'fertilization' | 'harvest' | 'general';
  urgency: 'info' | 'medium' | 'high' | 'critical';
  message: string;
  actionItems: string[];
}

// ============================================================================
// Underwriting — Расчёт премии
// Документ: "андеррайтинг — расчёт вероятности наступления страхового 
// случая и определение справедливой стоимости премии перед продажей полиса"
// ============================================================================

export function calculatePremium(
  coverageAmount: number,
  historicalFrostProbability: number,   // 0-1, из 30+ лет данных Ambee
  historicalDroughtProbability: number, // 0-1
  fieldAreaHectares: number,
  cropRiskMultiplier: number,           // 1.0-2.0 в зависимости от культуры
): number {
  // Базовый актуарный расчёт
  const combinedRisk = 1 - (1 - historicalFrostProbability) * (1 - historicalDroughtProbability);
  const basePremium = coverageAmount * combinedRisk;
  
  // Поправки
  const areaAdjustment = Math.min(fieldAreaHectares / 100, 2.0); // Масштабирование по площади
  const managementFee = coverageAmount * 0.05; // 5% на управление пулом
  
  const totalPremium = (basePremium * cropRiskMultiplier * areaAdjustment) + managementFee;
  
  return Math.round(totalPremium);
}

// ============================================================================
// Payout Decision
// ============================================================================

/**
 * Принятие решения о выплате на основе двух уровней верификации:
 * 1. Метеорологический триггер (MetGIS/Ambee)
 * 2. Спутниковая верификация NDVI (EOSDA)
 * 
 * Документ: "Температурные триггеры фиксируют лишь вероятность ущерба, 
 * в то время как NDVI отражает фактическое биологическое состояние биомассы"
 */
export function makePayoutDecision(
  policy: PolicyParams,
  weatherEval: TriggerEvaluation,
  ndviEval: NdviTriggerResult | null,
): PayoutDecision {
  // Если метеотриггер не сработал — нет выплаты
  if (!weatherEval.frostTriggered && !weatherEval.droughtTriggered) {
    return {
      shouldPayout: false,
      amount: 0,
      reason: 'Метеоусловия в пределах нормы. Триггеры не сработали.',
      weatherEvidence: weatherEval,
      ndviEvidence: ndviEval,
      confidenceScore: 0.95,
    };
  }

  // Метеотриггер сработал — нужна NDVI верификация
  if (!ndviEval) {
    return {
      shouldPayout: false,
      amount: 0,
      reason: 'Метеотриггер сработал. Ожидание спутниковой верификации NDVI (EOSDA/Sentinel-2).',
      weatherEvidence: weatherEval,
      ndviEvidence: null,
      confidenceScore: 0.5,
    };
  }

  // Оба триггера — полная выплата
  if (ndviEval.ndviTriggered) {
    // Расчёт суммы выплаты пропорционально ущербу
    const damageRatio = Math.min(Math.abs(ndviEval.deltaPercent) / 100, 1.0);
    const payoutAmount = Math.round(policy.coverageAmount * damageRatio);

    return {
      shouldPayout: true,
      amount: payoutAmount,
      reason: `Метеотриггер подтверждён + NDVI падение ${ndviEval.deltaPercent.toFixed(1)}% подтверждает ущерб. Выплата ${payoutAmount} USDC.`,
      weatherEvidence: weatherEval,
      ndviEvidence: ndviEval,
      confidenceScore: 0.98,
    };
  }

  // Метеотриггер сработал, но NDVI не подтвердил ущерб
  return {
    shouldPayout: false,
    amount: 0,
    reason: `Метеотриггер сработал, но спутниковые данные не подтверждают ущерб (NDVI delta: ${ndviEval.deltaPercent.toFixed(1)}%). Мониторинг продолжается.`,
    weatherEvidence: weatherEval,
    ndviEvidence: ndviEval,
    confidenceScore: 0.85,
  };
}

// ============================================================================
// Agronomic Recommendations
// ============================================================================

export async function generateRecommendation(
  weatherEval: TriggerEvaluation,
  ndviEval: NdviTriggerResult | null,
  cropType: string,
): Promise<AgronomicRecommendation> {
  // Проверка наличия API ключа для LLM (ключ ДОЛЖЕН быть в .env, не в коде!)
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn('[AI] ⚠️ Нет API ключа LLM (GROQ_API_KEY / OPENROUTER_API_KEY). Используем детерминированную рекомендацию.');
    return fallbackRecommendation(weatherEval, ndviEval, cropType);
  }

  try {
    // Инициализируем клиента через Groq (ключ из .env)
    const groqProvider = createOpenAI({
      apiKey: process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY!,
      baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1',
    });
    
    let ndviText = 'Недоступно';
    if (ndviEval) {
      ndviText = `Дельта NDVI: ${ndviEval.deltaPercent.toFixed(1)}%. Историческая норма: ${ndviEval.historicalMean.toFixed(2)}. Текущее: ${ndviEval.currentMean.toFixed(2)}`;
    }

    const systemPrompt = `Ты профессиональный ИИ-агроном проекта SmartFarmer.
    Твоя задача — проанализировать гиперлокальные метеоданные и спутниковые снимки NDVI 
    для конкретного поля и выдать четкую агрономическую рекомендацию фермеру.
    Культура: ${cropType}. 
    Температура: ${weatherEval.temperature}°C. Заморозки: ${weatherEval.frostTriggered ? 'Да' : 'Нет'}.
    Осадки: ${weatherEval.precipitationOverPeriod}мм. Засуха: ${weatherEval.droughtTriggered ? 'Да' : 'Нет'}.
    Спутник: ${ndviText}.`;

    const systemPromptFinal = systemPrompt + `
ВАЖНО: Ответь СТРОГО в виде JSON, без форматирования Markdown (без \`\`\`json). Выведи только этот объект и больше ничего:
{
  "type": "irrigation" | "frost_warning" | "drought_warning" | "fertilization" | "harvest" | "general",
  "urgency": "info" | "medium" | "high" | "critical",
  "message": "строка с рекомендацией",
  "actionItems": ["шаг 1", "шаг 2"]
}`;

    const gptResult = await generateText({
      model: groqProvider('llama-3.1-8b-instant'),
      prompt: systemPromptFinal,
    });
    
    // Ручной безопасный парсинг JSON ответа
    let jsonText = gptResult.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json/, '');
    if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```/, '');
    if (jsonText.endsWith('```')) jsonText = jsonText.replace(/```$/, '');
    
    const parsedData = JSON.parse(jsonText.trim());
    
    return {
      type: parsedData.type || 'general',
      urgency: parsedData.urgency || 'medium',
      message: parsedData.message || 'Рекомендация сгенерирована',
      actionItems: parsedData.actionItems || []
    } as AgronomicRecommendation;
  } catch (error: any) {
    console.error('[AI] Ошибка генерации (LLM):', error.message, error.stack || '');
    return fallbackRecommendation(weatherEval, ndviEval, cropType);
  }
}

function fallbackRecommendation(
  weatherEval: TriggerEvaluation,
  ndviEval: NdviTriggerResult | null,
  cropType: string,
): AgronomicRecommendation {
  // Критическое предупреждение о заморозках
  if (weatherEval.frostTriggered) {
    return {
      type: 'frost_warning',
      urgency: 'critical',
      message: `🥶 ВНИМАНИЕ: Температура ${weatherEval.temperature}°C — ниже критического порога. Посевам ${cropType} грозят заморозки.`,
      actionItems: [
        'Провести экстренный полив для защиты корневой системы',
        'Рассмотреть использование агроволокна для укрытия посевов'
      ],
    };
  }

  // Предупреждение о засухе
  if (weatherEval.droughtTriggered) {
    return {
      type: 'drought_warning',
      urgency: 'high',
      message: `☀️ Засуха: осадки ${weatherEval.precipitationOverPeriod}мм — ниже нормы. Рекомендуется усиленный полив.`,
      actionItems: [
        'Увеличить объём ирригации на 30-50%'
      ],
    };
  }

  // Всё в норме
  return {
    type: 'general',
    urgency: 'info',
    message: `✅ Состояние посевов ${cropType} в норме. Метеоусловия благоприятны, NDVI стабилен.`,
    actionItems: [
      'Продолжать штатный режим ирригации',
      'Следующая проверка через 24 часа',
    ],
  };
}

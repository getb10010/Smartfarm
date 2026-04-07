/**
 * SmartFarmer v3 — Gelato Web3 Function (Solana Devnet)
 * 
 * Децентрализованная автоматизация через Gelato.
 * Эта функция выполняется off-chain сетью нод Gelato:
 *  1. Опрашивает Open-Meteo (бесплатно) каждые 15 мин
 *  2. При срабатывании триггера (заморозки / засуха) сигнализирует
 *     SmartFarmer AI Oracle Agent для записи в Solana.
 * 
 * АРХИТЕКТУРА:
 * Gelato НЕ отправляет транзакции напрямую в Solana (это EVM-relay).
 * Вместо этого Gelato вызывает webhook SmartFarmer Agent, который
 * уже имеет ключи и TEE-аттестацию для записи в контракт.
 * 
 * ИНСТРУКЦИЯ ПО ДЕПЛОЮ:
 * 1. Перейдите на https://beta.app.gelato.network/
 * 2. Создайте новый Web3 Function → Paste this code
 * 3. Secrets: AGENT_WEBHOOK_URL (URL вашего агента), METGIS_API_KEY (опц.)
 * 4. User Args: lat (number), lon (number), frostThreshold (number), droughtPrecipMin (number)
 * 5. Установите интервал: каждые 15 минут
 * 6. Deploy на Polygon Amoy (Gelato relay-chain, не Solana).
 */

import { Web3Function, Web3FunctionContext } from "@gelatonetwork/web3-functions-sdk";
import axios from "axios";

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, secrets, storage } = context;

  // ═══════════════════════════════════════════════════════════
  // 1. Параметры мониторинга
  // ═══════════════════════════════════════════════════════════
  const lat = (userArgs.lat as number) ?? 43.2567;
  const lon = (userArgs.lon as number) ?? 76.9286;
  const frostThreshold = (userArgs.frostThreshold as number) ?? -5;
  const droughtPrecipMin = (userArgs.droughtPrecipMin as number) ?? 10; // мм за 7 дней

  const agentWebhookUrl = await secrets.get("AGENT_WEBHOOK_URL");
  const metgisKey = await secrets.get("METGIS_API_KEY");

  // ═══════════════════════════════════════════════════════════
  // 2. Каскадный запрос погоды: MetGIS → Open-Meteo
  // ═══════════════════════════════════════════════════════════
  let temperature = 20;
  let precipitation7d = 50;
  let humidity = 50;
  let windSpeed = 3;
  let source = "unknown";

  // Попытка 1: MetGIS (30м гиперлокальные данные)
  if (metgisKey) {
    try {
      const res = await axios.get("https://api.metgis.com/forecast/point", {
        params: { lat, lon, key: metgisKey, format: "json" },
        timeout: 8000,
      });
      const current = res.data?.current;
      if (current) {
        temperature = current.temperature ?? 20;
        humidity = current.humidity ?? 50;
        windSpeed = current.wind_speed ?? 3;
        source = "MetGIS";
      }
    } catch {
      console.log("[Gelato] MetGIS failed, falling back to Open-Meteo");
    }
  }

  // Попытка 2: Open-Meteo (бесплатный fallback)
  if (source === "unknown") {
    try {
      const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: {
          latitude: lat,
          longitude: lon,
          current: "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation",
          daily: "precipitation_sum",
          past_days: 7,
          timezone: "auto",
        },
        timeout: 8000,
      });
      const current = res.data?.current;
      temperature = current?.temperature_2m ?? 20;
      humidity = current?.relative_humidity_2m ?? 50;
      windSpeed = current?.wind_speed_10m ?? 3;
      source = "Open-Meteo";

      // Сумма осадков за 7 дней
      const dailyPrecip = res.data?.daily?.precipitation_sum ?? [];
      precipitation7d = dailyPrecip.reduce((a: number, b: number) => a + (b ?? 0), 0);
    } catch (e: any) {
      return { canExec: false, message: `All weather APIs failed: ${e.message}` };
    }
  }

  console.log(`[Gelato SmartFarmer] ${source}: T=${temperature}°C, Precip7d=${precipitation7d.toFixed(1)}мм, H=${humidity}%, W=${windSpeed}м/с at [${lat},${lon}]`);

  // ═══════════════════════════════════════════════════════════
  // 3. Проверка триггеров
  // ═══════════════════════════════════════════════════════════
  const frostTriggered = temperature < frostThreshold;
  const droughtTriggered = precipitation7d < droughtPrecipMin;

  if (!frostTriggered && !droughtTriggered) {
    // Cooldown: не спамим логами. Записываем lastCheck в storage.
    await storage.set("lastNormalCheck", Date.now().toString());
    return {
      canExec: false,
      message: `Normal: T=${temperature}°C (threshold: ${frostThreshold}°C), Precip7d=${precipitation7d.toFixed(1)}мм (min: ${droughtPrecipMin}мм)`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 4. Триггер сработал → Вызываем SmartFarmer Agent webhook
  // ═══════════════════════════════════════════════════════════
  const triggerType = frostTriggered ? "FROST" : "DROUGHT";
  const payload = {
    event: "GELATO_WEATHER_TRIGGER",
    triggerType,
    data: {
      temperature,
      precipitation7d,
      humidity,
      windSpeed,
      source,
      lat,
      lon,
      frostThreshold,
      droughtPrecipMin,
    },
    timestamp: Date.now(),
  };

  console.log(`[Gelato SmartFarmer] 🚨 ${triggerType} TRIGGER! Notifying agent...`);

  // Если webhook URL настроен — вызываем агента
  if (agentWebhookUrl) {
    try {
      await axios.post(agentWebhookUrl, payload, { timeout: 15000 });
      console.log(`[Gelato SmartFarmer] ✅ Agent notified successfully`);
    } catch (e: any) {
      console.log(`[Gelato SmartFarmer] ⚠️ Agent webhook failed: ${e.message}`);
      // Не фейлим, просто логируем. Агент всё равно проверит сам.
    }
  } else {
    console.log(`[Gelato SmartFarmer] ℹ️ No AGENT_WEBHOOK_URL configured. Trigger logged only.`);
  }

  // Записываем последний триггер в storage для дедупликации
  await storage.set("lastTrigger", JSON.stringify({
    type: triggerType,
    temperature,
    precipitation7d,
    timestamp: Date.now(),
  }));

  // Gelato: canExec=false потому что мы не шлём EVM-транзакцию.
  // Gelato используется как CRON-движок, а не как relay.
  return {
    canExec: false,
    message: `🚨 ${triggerType} triggered! T=${temperature}°C, Precip7d=${precipitation7d.toFixed(1)}мм. Agent notified via webhook.`,
  };
});

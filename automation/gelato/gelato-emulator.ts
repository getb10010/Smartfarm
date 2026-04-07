import axios from "axios";

/**
 * Gelato Web3 Function Emulator (Local Fallback)
 * 
 * Так как сервера Onchain Cloud (Gelato) лежат с ошибкой 500 Postgres,
 * этот скрипт локально эмулирует логику Web3 Function для питча.
 * Он опрашивает Open-Meteo каждые N секунд и через webhook пушит Агента.
 */

// Конфигурация, идентичная Gelato Task
const CONFIG = {
    lat: 43.25,
    lon: 76.92,
    frostThreshold: -5,
    droughtPrecipMin: 10,
    agentWebhookUrl: "http://localhost:3000/webhook/gelato", // Ссылка на наш локальный агент
    intervalMs: 15000, // 15 секунд для ДЕМО (в реале 15 минут)
};

async function runGelatoTask() {
    console.log(`\n[Gelato Emulator] 🔄 Запуск проверки погоды...`);
    
    try {
        // Запрос бесплатной погоды Open-Meteo
        const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
            params: {
              latitude: CONFIG.lat,
              longitude: CONFIG.lon,
              current: "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation",
              daily: "precipitation_sum",
              past_days: 7,
              timezone: "auto",
            },
            timeout: 8000,
        });

        const current = res.data?.current;
        const temperature = current?.temperature_2m ?? 20;
        const precipitation7d = (res.data?.daily?.precipitation_sum ?? []).reduce((a: number, b: number) => a + (b || 0), 0);
        
        console.log(`[Gelato Emulator] 🌡️ Температура: ${temperature}°C, Осадки за 7д: ${precipitation7d}мм`);

        // Проверка триггеров
        const frostTriggered = temperature < CONFIG.frostThreshold;
        const droughtTriggered = precipitation7d < CONFIG.droughtPrecipMin;

        if (!frostTriggered && !droughtTriggered) {
             console.log(`[Gelato Emulator] ✅ Всё в норме. Триггер не сработал. Ждем...`);
             return;
        }

        const triggerType = frostTriggered ? "FROST" : "DROUGHT";
        console.log(`[Gelato Emulator] 🚨 СРАБОТАЛ ТРИГГЕР: ${triggerType}! Отправка Webhook Агенту...`);

        // Пингуем агента (эмуляция транзакции Gelato)
        try {
            await axios.post(CONFIG.agentWebhookUrl, {
                event: "GELATO_WEATHER_TRIGGER",
                triggerType,
                data: { temperature, precipitation7d, source: "Open-Meteo (Gelato Emulator)" }
            });
            console.log(`[Gelato Emulator] 📨 Webhook успешно доставлен Агенту.`);
        } catch (e: any) {
             console.log(`[Gelato Emulator] ⚠️ Ошибка доставки Webhook: Агент не запущен на порту 3000?`);
        }

    } catch (e: any) {
        console.error(`[Gelato Emulator] Ошибка получения погоды: ${e.message}`);
    }
}

// Запускаем бесконечный цикл
console.log(`🚀 Gelato Web3 Function эмулятор запущен. Интервал: ${CONFIG.intervalMs / 1000} сек.`);
runGelatoTask();
setInterval(runGelatoTask, CONFIG.intervalMs);

import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('❌ TELEGRAM_BOT_TOKEN is missing in .env!');
}

// URL твоего Web App (если он не задан в .env, используем заглушку)
const webAppUrl = process.env.WEBAPP_URL || 'https://smartfarmer-app.vercel.app'; 

const bot = new Telegraf(token);

// Обработка команды /start
bot.start((ctx) => {
  ctx.reply(
    '🌾 <b>Добро пожаловать в SmartFarmer v3!</b>\n\n' +
    'Я ваш автономный ИИ-Агроном. Я мониторю погоду, анализирую спутниковые снимки (NDVI) и <b>автоматически </b>выплачиваю компенсации при заморозках или засухе.\n\n' +
    'Нажмите кнопку ниже, чтобы открыть Web3-панель управления страховками.',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        Markup.button.webApp('🚀 Запустить Дашборд', webAppUrl)
      ])
    }
  );
});

// Обработка команды /help
bot.help((ctx) => {
  ctx.reply(
    'Просто нажмите "Запустить Дашборд" для входа в приложение.\n' +
    'Я буду автоматически присылать вам уведомления, если с вашим полем что-то случится.'
  );
});

// Запуск бота
// bot.launch().then(() => {
//   console.log('✅ Telegram Bot Server is running! Waiting for /start commands...');
//   console.log(`🔗 WebApp URL configured to: ${webAppUrl}`);
// });

// Безопасное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

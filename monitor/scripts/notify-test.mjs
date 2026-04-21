// Testea que TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID estén bien.
// Uso local: TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node scripts/notify-test.mjs

import { sendTelegram } from './lib/telegram.mjs';

const r = await sendTelegram(
  `🧪 <b>Test desde site-monitor</b>\nSi lees esto, las credenciales funcionan.\n<i>${new Date().toISOString()}</i>`
);
console.log(r);
process.exit(r.ok ? 0 : 1);

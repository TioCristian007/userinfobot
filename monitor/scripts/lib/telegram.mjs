// Telegram Bot API - envío simple. Token y chat_id vienen por env.

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('[telegram] Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID — skip');
    return { ok: false, reason: 'no_credentials' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[telegram] API error:', data);
      return { ok: false, reason: data.description };
    }
    return { ok: true };
  } catch (e) {
    console.error('[telegram] send failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', none: '🟢' };

export function formatIncident({ domain, diag, http, dnsNS }) {
  const icon = ICON[diag.severity] || '⚠️';
  const lines = [
    `${icon} <b>${escape(domain)}</b> — ${escape(diag.layer)}`,
    ``,
    `<b>${escape(diag.summary)}</b>`,
  ];
  if (diag.findings?.length) {
    lines.push('');
    for (const f of diag.findings) lines.push(`· ${escape(f)}`);
  }
  if (http?.status) lines.push(`\nHTTP ${http.status} · ${http.latencyMs}ms${http.cfRay ? ` · cf-ray ${http.cfRay.slice(0, 12)}` : ''}`);
  if (dnsNS?.list?.length) lines.push(`NS: ${dnsNS.list.slice(0, 2).map(escape).join(', ')}`);
  lines.push(`\n<i>${new Date().toISOString()}</i>`);
  return lines.join('\n');
}

export function formatRecovery({ domain, downSince }) {
  const mins = downSince ? Math.round((Date.now() - new Date(downSince).getTime()) / 60000) : null;
  return [
    `🟢 <b>${escape(domain)}</b> — RECUPERADO`,
    mins !== null ? `Downtime: ~${mins} min` : '',
    `<i>${new Date().toISOString()}</i>`,
  ].filter(Boolean).join('\n');
}

function escape(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

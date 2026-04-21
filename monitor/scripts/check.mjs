// Orquestador: lee sites.json, corre checks en paralelo, actualiza status.json + incidents.json,
// dispara Telegram en transiciones OK→FAIL y FAIL→OK.

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolve, getNS, nsLooksLikeCloudflare } from './lib/dns.mjs';
import { httpCheck } from './lib/http.mjs';
import { diagnose } from './lib/interpret.mjs';
import { sendTelegram, formatIncident, formatRecovery } from './lib/telegram.mjs';

const ROOT = path.resolve('.');
const P_SITES = path.join(ROOT, 'data/sites.json');
const P_STATUS = path.join(ROOT, 'data/status.json');
const P_INCIDENTS = path.join(ROOT, 'data/incidents.json');

const FAIL_STREAK_TO_ALERT = 2; // 2 checks consecutivos fallidos = alerta (evita falsos positivos)
const MAX_INCIDENTS_KEPT = 500;

async function readJSON(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function writeJSON(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n');
}

async function checkSite(site) {
  const domain = site.domain;
  const [dnsA, nsList] = await Promise.all([
    resolve(domain, 'A').catch(e => ({ ok: false, reason: `DoH_ERR:${e.message}`, answers: [] })),
    getNS(domain).catch(() => []),
  ]);

  const dnsNS = {
    list: nsList,
    nsLooksLikeCloudflare: nsLooksLikeCloudflare(nsList),
  };

  const http = await httpCheck(domain, {
    expectedStatus: site.expectedStatus ?? 200,
    expectedContent: site.expectedContent || null,
  });

  const diag = diagnose({ site, dnsA, dnsNS, http });
  const isUp = diag.layer === 'OK' || diag.warningOnly === true;

  return { domain, isUp, diag, http, dnsNS };
}

async function main() {
  const { sites = [] } = await readJSON(P_SITES, { sites: [] });
  const enabled = sites.filter(s => s.enabled !== false);
  if (enabled.length === 0) {
    console.log('Sin sitios habilitados. Nada que chequear.');
    await writeJSON(P_STATUS, { lastRun: new Date().toISOString(), sites: {} });
    return;
  }

  const prev = await readJSON(P_STATUS, { sites: {} });
  const incidentsFile = await readJSON(P_INCIDENTS, { incidents: [] });

  console.log(`Checking ${enabled.length} site(s)...`);
  const results = await Promise.all(enabled.map(checkSite));

  const now = new Date().toISOString();
  const nextSites = {};
  const alerts = [];
  const recoveries = [];

  for (const r of results) {
    const prevSite = prev.sites?.[r.domain] || {};
    const prevStreak = prevSite.failStreak || 0;
    const prevAlerted = prevSite.alerted || false;
    const prevDownSince = prevSite.downSince || null;

    const failStreak = r.isUp ? 0 : prevStreak + 1;

    const entry = {
      lastCheck: now,
      isUp: r.isUp,
      layer: r.diag.layer,
      severity: r.diag.severity,
      summary: r.diag.summary,
      findings: r.diag.findings,
      http: {
        status: r.http.status,
        latencyMs: r.http.latencyMs,
        viaCloudflare: r.http.viaCloudflare,
        cfRay: r.http.cfRay,
        server: r.http.server,
      },
      ns: r.dnsNS.list,
      nsOnCloudflare: r.dnsNS.nsLooksLikeCloudflare,
      failStreak,
      downSince: r.isUp ? null : (prevDownSince || now),
      alerted: prevAlerted,
    };

    // Disparar alerta si lleva N checks fallando y aún no avisamos
    if (!r.isUp && failStreak >= FAIL_STREAK_TO_ALERT && !prevAlerted) {
      alerts.push(r);
      entry.alerted = true;
      incidentsFile.incidents.unshift({
        id: `${r.domain}-${Date.now()}`,
        domain: r.domain,
        startedAt: entry.downSince,
        detectedAt: now,
        layer: r.diag.layer,
        severity: r.diag.severity,
        summary: r.diag.summary,
        findings: r.diag.findings,
        http: entry.http,
        resolved: false,
        resolvedAt: null,
      });
    }

    // Recovery: estaba avisado como caído y ahora está OK
    if (r.isUp && prevAlerted) {
      recoveries.push({ ...r, downSince: prevDownSince });
      entry.alerted = false;
      // Marcar el último incidente abierto de este dominio como resuelto
      const openIdx = incidentsFile.incidents.findIndex(i => i.domain === r.domain && !i.resolved);
      if (openIdx >= 0) {
        incidentsFile.incidents[openIdx].resolved = true;
        incidentsFile.incidents[openIdx].resolvedAt = now;
      }
    }

    nextSites[r.domain] = entry;

    console.log(
      `${r.isUp ? 'UP  ' : 'DOWN'} ${r.domain.padEnd(30)} [${r.diag.layer}] ${r.diag.summary}`
    );
  }

  // Truncar log
  if (incidentsFile.incidents.length > MAX_INCIDENTS_KEPT) {
    incidentsFile.incidents = incidentsFile.incidents.slice(0, MAX_INCIDENTS_KEPT);
  }

  await writeJSON(P_STATUS, { lastRun: now, sites: nextSites });
  await writeJSON(P_INCIDENTS, incidentsFile);

  // Notificar
  for (const a of alerts) {
    const msg = formatIncident({ domain: a.domain, diag: a.diag, http: a.http, dnsNS: a.dnsNS });
    await sendTelegram(msg);
  }
  for (const r of recoveries) {
    await sendTelegram(formatRecovery({ domain: r.domain, downSince: r.downSince }));
  }

  console.log(`Done. Alerts=${alerts.length} Recoveries=${recoveries.length}`);
}

main().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});

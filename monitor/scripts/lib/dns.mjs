// DNS-over-HTTPS client. Usa Cloudflare como primario, Google como fallback.
// Evita problemas de red en el runner de Actions.

const DOH_PRIMARY = 'https://cloudflare-dns.com/dns-query';
const DOH_FALLBACK = 'https://dns.google/resolve';

async function query(endpoint, domain, type) {
  const url = `${endpoint}?name=${encodeURIComponent(domain)}&type=${type}`;
  const res = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DoH ${res.status}`);
  return res.json();
}

export async function resolve(domain, type = 'A') {
  let data;
  try {
    data = await query(DOH_PRIMARY, domain, type);
  } catch {
    data = await query(DOH_FALLBACK, domain, type);
  }

  // Status: 0 = NOERROR, 3 = NXDOMAIN
  if (data.Status === 3) return { ok: false, reason: 'NXDOMAIN', answers: [] };
  if (data.Status !== 0) return { ok: false, reason: `DNS status ${data.Status}`, answers: [] };

  const answers = (data.Answer || []).map(a => a.data);
  return { ok: answers.length > 0, reason: answers.length ? null : 'NO_ANSWER', answers };
}

export async function getNS(domain) {
  const apex = apexOf(domain);
  const r = await resolve(apex, 'NS');
  return r.answers.map(s => s.replace(/\.$/, '').toLowerCase());
}

export function apexOf(domain) {
  // Heurística: NIC Chile usa .cl y varios SLDs (.co.cl, etc). Mantenemos simple:
  // asumimos dominio.cl o subdominio.dominio.cl. Para NS consultamos el apex.
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;
  // Soporta co.cl, gob.cl, etc (segundo-nivel conocido)
  const secondLevel = ['co', 'gob', 'gov', 'edu', 'mil', 'org', 'net'];
  if (parts.length >= 3 && secondLevel.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function nsLooksLikeCloudflare(nsList) {
  return nsList.some(ns => ns.endsWith('.ns.cloudflare.com') || ns.endsWith('.cloudflare.com'));
}

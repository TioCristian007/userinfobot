// HTTP checks: status, Cloudflare detection, latencia, contenido.
// Certificado TLS lo inferimos del handshake (si fetch tira error TLS, es cert).

export async function httpCheck(domain, { expectedStatus = 200, expectedContent = null } = {}) {
  const url = `https://${domain}/`;
  const t0 = Date.now();

  let res, body = '', errorKind = null, errorMsg = null;

  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'site-monitor/1.0 (+github-actions)',
        'accept': 'text/html,*/*',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/certificate|cert|TLS|SSL/i.test(msg)) errorKind = 'TLS';
    else if (/timeout|aborted/i.test(msg)) errorKind = 'TIMEOUT';
    else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) errorKind = 'DNS_RESOLVE';
    else if (/ECONNREFUSED|ECONNRESET|network/i.test(msg)) errorKind = 'NETWORK';
    else errorKind = 'FETCH';
    errorMsg = msg;
    return {
      ok: false,
      errorKind,
      errorMsg,
      latencyMs: Date.now() - t0,
      status: null,
      viaCloudflare: false,
      cfRay: null,
      server: null,
      contentOk: null,
      finalUrl: null,
    };
  }

  try {
    body = await res.text();
  } catch {
    body = '';
  }

  const latencyMs = Date.now() - t0;
  const cfRay = res.headers.get('cf-ray');
  const server = res.headers.get('server');
  const viaCloudflare = Boolean(cfRay) || /cloudflare/i.test(server || '');

  let contentOk = null;
  if (expectedContent) {
    contentOk = body.includes(expectedContent);
  }

  const statusOk = res.status === expectedStatus;

  return {
    ok: statusOk && (contentOk === null ? true : contentOk),
    errorKind: statusOk ? null : 'BAD_STATUS',
    errorMsg: null,
    latencyMs,
    status: res.status,
    viaCloudflare,
    cfRay,
    server,
    contentOk,
    finalUrl: res.url,
  };
}

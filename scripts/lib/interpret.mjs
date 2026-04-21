// Diagnóstico: combina resultados DNS + HTTP y determina QUÉ capa falló.
// Capas: NIC_CHILE (registro/NS) → CLOUDFLARE (proxy/SSL) → ORIGIN (Pages) → CONTENT

export function diagnose({ site, dnsA, dnsNS, http }) {
  const findings = [];

  // Capa 1: Resolución DNS básica
  if (!dnsA.ok) {
    if (dnsA.reason === 'NXDOMAIN') {
      return {
        layer: 'NIC_CHILE',
        severity: 'critical',
        summary: `Dominio no existe (NXDOMAIN). ¿Expiró el registro en NIC Chile?`,
        findings: ['NXDOMAIN en DNS-over-HTTPS'],
      };
    }
    return {
      layer: 'DNS',
      severity: 'critical',
      summary: `DNS no resuelve: ${dnsA.reason}`,
      findings: [`Resolución A falló: ${dnsA.reason}`],
    };
  }

  // Capa 2: NS (¿apunta a Cloudflare?)
  const nsIsCF = dnsNS.nsLooksLikeCloudflare;
  if (!nsIsCF && dnsNS.list.length > 0) {
    findings.push(`NS actuales: ${dnsNS.list.join(', ')}`);
    return {
      layer: 'NIC_CHILE',
      severity: 'critical',
      summary: `Los NS NO apuntan a Cloudflare. Revisar delegación en NIC Chile.`,
      findings,
    };
  }
  if (dnsNS.list.length === 0) {
    return {
      layer: 'NIC_CHILE',
      severity: 'high',
      summary: `Sin registros NS. Dominio sin delegar.`,
      findings: ['Query NS vacía'],
    };
  }

  // Capa 3: HTTP / Cloudflare
  if (!http.ok) {
    switch (http.errorKind) {
      case 'TLS':
        return {
          layer: 'CLOUDFLARE',
          severity: 'critical',
          summary: `Certificado SSL inválido. Revisar modo SSL en Cloudflare (Full/Flexible) y Universal SSL.`,
          findings: [http.errorMsg],
        };
      case 'TIMEOUT':
        return {
          layer: 'CLOUDFLARE',
          severity: 'high',
          summary: `Timeout en HTTPS. Cloudflare no responde o está bloqueado.`,
          findings: [`>15s sin respuesta`],
        };
      case 'DNS_RESOLVE':
        return {
          layer: 'DNS',
          severity: 'critical',
          summary: `Runner no resuelve el dominio (DNS local falló pese a DoH OK). Probable propagación.`,
          findings: [http.errorMsg],
        };
      case 'NETWORK':
        return {
          layer: 'CLOUDFLARE',
          severity: 'high',
          summary: `Conexión rechazada/reseteada al conectar.`,
          findings: [http.errorMsg],
        };
      case 'BAD_STATUS': {
        // Hay respuesta — capa DNS/CF están OK
        const s = http.status;
        if (s >= 500 && s < 600) {
          if (http.viaCloudflare) {
            return {
              layer: 'ORIGIN',
              severity: 'critical',
              summary: `Cloudflare devuelve ${s}. Origen (Cloudflare Pages) caído o build roto.`,
              findings: [`cf-ray=${http.cfRay}`, `status=${s}`],
            };
          }
          return {
            layer: 'ORIGIN',
            severity: 'critical',
            summary: `5xx sin pasar por Cloudflare (server=${http.server}). ¿DNS apunta fuera de CF?`,
            findings: [`status=${s}`, `server=${http.server}`],
          };
        }
        if (s === 404) {
          return {
            layer: 'ORIGIN',
            severity: 'high',
            summary: `404. Pages sin deploy o routing mal configurado.`,
            findings: [`cf-ray=${http.cfRay || 'n/a'}`],
          };
        }
        if (s === 403 || s === 401) {
          return {
            layer: 'CLOUDFLARE',
            severity: 'medium',
            summary: `${s} — regla de firewall/Access bloqueando el monitor.`,
            findings: [`Considerá whitelistear el runner o el UA "site-monitor/1.0"`],
          };
        }
        if (s >= 300 && s < 400) {
          return {
            layer: 'CLOUDFLARE',
            severity: 'low',
            summary: `Redirect inesperado (${s}) → ${http.finalUrl}`,
            findings: [],
          };
        }
        return {
          layer: 'CLOUDFLARE',
          severity: 'medium',
          summary: `Status inesperado ${s} (esperado ${site.expectedStatus || 200}).`,
          findings: [`cf-ray=${http.cfRay || 'n/a'}`],
        };
      }
      default:
        return {
          layer: 'UNKNOWN',
          severity: 'medium',
          summary: `Error: ${http.errorMsg || http.errorKind}`,
          findings: [],
        };
    }
  }

  // Capa 4: Contenido
  if (http.contentOk === false) {
    return {
      layer: 'CONTENT',
      severity: 'medium',
      summary: `Responde 200 pero no contiene "${site.expectedContent}". Posible deploy viejo o contenido corrupto.`,
      findings: [`cf-ray=${http.cfRay}`],
    };
  }

  // Advertencia: todo OK pero no pasa por Cloudflare
  if (!http.viaCloudflare) {
    return {
      layer: 'CLOUDFLARE',
      severity: 'low',
      summary: `Sitio responde pero NO via Cloudflare (server=${http.server}). Proxy desactivado.`,
      findings: [],
      warningOnly: true,
    };
  }

  return { layer: 'OK', severity: 'none', summary: 'Todo OK', findings: [] };
}

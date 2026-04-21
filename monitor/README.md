# site-monitor

Monitor 24/7 para sitios estáticos en **Cloudflare Pages + Cloudflare DNS + NIC Chile (.cl)**.
Chequea en 4 capas (DNS apex, NS Cloudflare, HTTPS/Cloudflare/SSL, contenido),
diagnostica dónde está el problema y avisa por Telegram.

**Stack:**
- GitHub Actions (cron cada 5 min) = motor de checks
- Repo GitHub = storage (JSON commiteado)
- Cloudflare Pages = UI del dashboard
- Cloudflare Access = login (gratis, hasta 50 usuarios)
- Telegram Bot API = alertas

---

## 1. Crear el bot de Telegram

1. Abrir Telegram → buscar **@BotFather**
2. `/newbot` → nombre libre → username debe terminar en `bot` (ej. `tuwebatupintamonitorbot`)
3. Guardar el **token** que te da (`123456:AAAA...`)
4. Buscar **@userinfobot** → `/start` → te devuelve tu **chat_id** (ej. `987654321`)
5. Enviarle `/start` a tu bot (sino no te puede escribir)

## 2. Setup del repo

```bash
git clone <este repo> site-monitor
cd site-monitor
```

**Importante:** el repo debe ser **público** para no gastarse los 2000 min/mes
del free tier de Actions (con cron 5 min gastarías ~4300 min). Los secrets
viven en GitHub Secrets, no en el código.

Si prefieres privado, cambiá el cron a `*/10 * * * *` en `.github/workflows/monitor.yml`.

### Secrets en GitHub

Settings → Secrets and variables → Actions → New repository secret:

- `TELEGRAM_BOT_TOKEN` = el token del BotFather
- `TELEGRAM_CHAT_ID` = tu chat_id

### Probar el bot (opcional, local)

```bash
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...
node scripts/notify-test.mjs
```

### Encender el cron

Push a `main`. El Action arranca solo. También podés correrlo manualmente
en Actions → monitor → Run workflow.

## 3. Deploy de la UI en Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Seleccionar el repo
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (vacío)
   - **Build output directory:** `ui`
4. Deploy
5. Cloudflare te da una URL `*.pages.dev`

### Dominio propio (opcional pero recomendado)

Custom domain en Pages → `monitor.tudominio.cl` (o subdominio que prefieras).

### Proteger con Cloudflare Access (crítico — sino queda abierto a internet)

1. **Zero Trust dashboard** → **Access** → **Applications** → **Add application**
2. Tipo **Self-hosted**
3. Domain: `monitor.tudominio.cl` (o el subdominio `*.pages.dev` si no usás custom)
4. **Policy:**
   - Action: **Allow**
   - Rule: **Emails** → `tu-email@ejemplo.com`
5. Save. Ahora la UI pide login por email antes de cargar.

## 4. Usar la app

1. Abrir la URL → Cloudflare Access te pide email → login
2. La app te pide **config**: owner, repo, branch, PAT
3. Crear un **PAT fine-grained** en GitHub:
   - Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Resource owner: tu usuario
   - Repository access: solo este repo
   - Permissions → Repository → **Contents: Read and write**
   - Generate → copiarlo a la app
4. Pegarlo en la app → guardar
5. **+ agregar** para sumar dominios

El PAT queda solo en tu `localStorage`. Si cambias de navegador, lo pegás de nuevo.

---

## Cómo funciona el diagnóstico

En cada check, el orden de detección es:

| Capa | Qué chequea | Si falla → diagnóstico |
|------|------------|------------------------|
| `NIC_CHILE` | Resolución A del apex + NS | NXDOMAIN, NS fuera de Cloudflare |
| `DNS` | Query DoH exitosa pero runner no resuelve | Propagación o DNS local del runner |
| `CLOUDFLARE` | Handshake TLS, respuesta HTTPS, headers CF | SSL inválido, timeout, 403/401 (firewall) |
| `ORIGIN` | Status 2xx/200 del origen | 5xx → Pages caído, 404 → build roto |
| `CONTENT` | Substring esperado en body | Deploy viejo o contenido corrupto |

Se notifica después de **2 checks fallidos consecutivos** (anti falso positivo
por flakiness puntual = 10 min de downtime real antes de molestarte).
El recovery (FAIL→OK) se notifica siempre.

---

## Configurar un sitio

Desde la UI o editando `data/sites.json` directo:

```json
{
  "sites": [
    {
      "domain": "tudominio.cl",
      "enabled": true,
      "expectedStatus": 200,
      "expectedContent": "Mi Sitio",
      "expectedNS": "cloudflare.com",
      "notes": "cliente X"
    }
  ]
}
```

- `expectedContent`: opcional. Si lo pones, se chequea que aparezca en el HTML.
- `enabled: false` → lo ignora sin borrarlo.

---

## Costos reales

| Ítem | Costo |
|------|-------|
| GitHub Actions (repo público) | $0 |
| Cloudflare Pages | $0 |
| Cloudflare Access (<50 usuarios) | $0 |
| Telegram Bot | $0 |
| **Total** | **$0 / mes** |

---

## Troubleshooting

**El Action corre pero no llegan mensajes a Telegram**
- Verificar que le mandaste `/start` al bot (sino no puede escribirte).
- Verificar `TELEGRAM_CHAT_ID` (es un número entero, no un @).
- Correr `node scripts/notify-test.mjs` con las env vars.

**La UI dice "Error cargando"**
- Owner/repo mal escritos.
- Repo privado + PAT sin scope `Contents:Read`.
- Rama mal (default `main`, algunos repos usan `master`).

**Agregar sitio falla con 403**
- El PAT no tiene `Contents: Read and write`.
- El PAT está vencido.

**False positives constantes en un sitio**
- Revisar si hay WAF/rule en Cloudflare bloqueando el UA `site-monitor/1.0`.
- Subir `expectedStatus` si el sitio responde 301/302 permanente.

**Agoté el free tier de Actions**
- Pasar repo a público, o bajar cron a `*/10 * * * *` o `*/15 * * * *`.

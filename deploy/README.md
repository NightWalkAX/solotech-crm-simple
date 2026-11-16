# Desplegar en AWS Lightsail + Cloudflare Tunnel

Arquitectura: una instancia Lightsail con Docker → contenedor `crm` (UI + API + chat en :8080, sin puertos abiertos)
+ contenedor `tunnel` (cloudflared). El tráfico entra solo por Cloudflare; Cloudflare Access pide el login.

## 1. Cloudflare (dominio del cliente en Cloudflare)
1. Zero Trust → Networks → Tunnels → **Create tunnel** (Cloudflared) → nombre `crm-<cliente>` → copia el **token**.
2. En el tunnel → **Public hostname**: `crm.<dominio>` → Service `HTTP` → `crm:8080`.
3. Zero Trust → Access → Applications → **Add (Self-hosted)** → dominio `crm.<dominio>`; política *Allow* con los
   correos del cliente (login por código al correo, o Google). Copia el **Application Audience (AUD) tag** y el nombre del
   equipo (`<team>.cloudflareaccess.com`).

## 2. Lightsail
1. Crear instancia Linux → **Ubuntu 24.04**, plan de **2 GB RAM** (≈ US$12/mes) o más. Sin abrir puertos extra
   (en Networking deja solo SSH, y puedes restringirlo a tu IP).
2. Activa **automatic snapshots** (instancia → Snapshots).
3. O todo de una vez desde **AWS CloudShell**: `bash <(curl -fsSL https://raw.githubusercontent.com/NightWalkAX/solotech-crm-simple/main/deploy/cloudshell.sh)`
   (crea la instancia, cierra el puerto 80, activa snapshots, escribe .env y arranca). Manual: SSH → `git clone https://github.com/NightWalkAX/solotech-crm-simple.git ~/crm && bash ~/crm/deploy/lightsail-setup.sh`
   (repo privado: usa un deploy key o un token de solo lectura). Sal y vuelve a entrar.

## 3. Configurar y arrancar
```bash
cd ~/crm && cp deploy/env.example .env && nano .env   # CLAUDE_CODE_OAUTH_TOKEN o ANTHROPIC_API_KEY, TUNNEL_TOKEN, CF_ACCESS_TEAM, CF_ACCESS_AUD
mkdir -p data claude-home && sudo chown -R 1000:1000 data claude-home
docker compose up -d --build
docker compose logs -f crm
```
Abre `https://crm.<dominio>` → login de Access → Integraciones → **Emisor y firma** (nombre del negocio y del dueño: la IA los usa).

## 4. Respaldos
`crontab -e` → `15 3 * * * /home/ubuntu/crm/deploy/backup.sh >> /home/ubuntu/crm/backups/backup.log 2>&1`

## Actualizar
`cd ~/crm && git pull && docker compose up -d --build`

## Notas
- `CRM_HOSTED=1` (en la imagen): el chat siempre corre en modo Edit (solo herramientas del CRM + web), nunca Bash ni
  edición de archivos en el servidor.
- La IA usa la cuenta de Claude del cliente: `claude setup-token` (suscripción) o su API key.
- Transcripción de notas de voz (Whisper) no viene en la imagen.

#!/usr/bin/env bash
# Run in AWS CloudShell (it already has the aws CLI and ssh):
#   bash <(curl -fsSL https://raw.githubusercontent.com/NightWalkAX/solotech-crm-simple/main/deploy/cloudshell.sh)
# Creates a Lightsail Ubuntu 24.04 instance, installs Docker, writes .env (secrets typed here, never in user-data),
# starts the CRM + Cloudflare Tunnel, closes port 80, enables daily snapshots and the nightly DB backup.
set -euo pipefail
REPO=https://github.com/NightWalkAX/solotech-crm-simple.git

ask() { local v; read -rp "$1 [$2]: " v; echo "${v:-$2}"; }
secret() { local v; read -rsp "$1: " v; echo >&2; echo "$v"; }

REGION=$(ask "Región AWS" "${AWS_REGION:-us-east-1}")
NAME=$(ask "Nombre de la instancia" "crm")
BUNDLE=$(ask "Plan (small_3_0 = 2 GB ~US\$12, medium_3_0 = 4 GB)" "small_3_0")
AZ="${REGION}a"
echo "--- Secretos (no se muestran al escribir) ---"
TUNNEL_TOKEN=$(secret "TUNNEL_TOKEN de Cloudflare")
CLAUDE_TOKEN=$(secret "CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) — Enter si usas API key")
API_KEY=""
[ -z "$CLAUDE_TOKEN" ] && API_KEY=$(secret "ANTHROPIC_API_KEY")
CF_TEAM=$(ask "Cloudflare Access team (xxx de xxx.cloudflareaccess.com, Enter = después)" "")
CF_AUD=""
[ -n "$CF_TEAM" ] && CF_AUD=$(ask "Cloudflare Access AUD tag" "")
[ -n "$TUNNEL_TOKEN" ] || { echo "Falta TUNNEL_TOKEN"; exit 1; }

export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
USERDATA=$(cat <<'UD'
#!/bin/bash
set -e
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
apt-get update -y && apt-get install -y git sqlite3 unattended-upgrades
UD
)

if aws lightsail get-instance --instance-name "$NAME" >/dev/null 2>&1; then
  echo "La instancia $NAME ya existe: la reutilizo."
else
  echo "Creando instancia $NAME ($BUNDLE, $AZ)…"
  aws lightsail create-instances --instance-names "$NAME" --availability-zone "$AZ" \
    --blueprint-id ubuntu_24_04 --bundle-id "$BUNDLE" --user-data "$USERDATA" >/dev/null
fi

until [ "$(aws lightsail get-instance --instance-name "$NAME" --query 'instance.state.name' --output text)" = running ]; do sleep 5; done
IP=$(aws lightsail get-instance --instance-name "$NAME" --query 'instance.publicIpAddress' --output text)
echo "Instancia corriendo en $IP"

# Only SSH stays open (the CRM is reached through the tunnel); Lightsail opens 80 by default.
aws lightsail close-instance-public-ports --instance-name "$NAME" --port-info fromPort=80,toPort=80,protocol=TCP >/dev/null || true
aws lightsail enable-add-on --resource-name "$NAME" \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=07:00}' >/dev/null || true

KEY=~/.ssh/lightsail-$REGION.pem
if [ ! -s "$KEY" ]; then
  mkdir -p ~/.ssh
  aws lightsail download-default-key-pair --query privateKeyBase64 --output text > "$KEY"
  chmod 600 "$KEY"
fi
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ubuntu@$IP"

echo "Esperando SSH…"
until $SSH true 2>/dev/null; do sleep 5; done
echo "Esperando a que termine la instalación de Docker (2-4 min)…"
$SSH 'sudo cloud-init status --wait >/dev/null; command -v docker >/dev/null'

$SSH "[ -d ~/crm/.git ] && git -C ~/crm pull -q || git clone -q $REPO ~/crm; mkdir -p ~/crm/data ~/crm/claude-home ~/crm/backups"
# .env through stdin: secrets never land in user-data, the shell history or the process list.
printf '%s\n' \
  "TUNNEL_TOKEN=$TUNNEL_TOKEN" \
  "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN" \
  "ANTHROPIC_API_KEY=$API_KEY" \
  "CF_ACCESS_TEAM=$CF_TEAM" \
  "CF_ACCESS_AUD=$CF_AUD" \
  "TZ=America/Guyana" \
  | $SSH 'umask 077; cat > ~/crm/.env'
$SSH 'sudo chown -R 1000:1000 ~/crm/data ~/crm/claude-home'

echo "Construyendo y arrancando (5-10 min la primera vez)…"
$SSH 'cd ~/crm && sudo docker compose up -d --build'
$SSH '(crontab -l 2>/dev/null | grep -v deploy/backup.sh; echo "15 3 * * * /home/ubuntu/crm/deploy/backup.sh >> /home/ubuntu/crm/backups/backup.log 2>&1") | crontab -'

echo "Comprobando…"
for i in $(seq 1 30); do $SSH 'sudo docker compose -f ~/crm/docker-compose.yml exec -T crm curl -fsS localhost:8080/healthz' 2>/dev/null && break; sleep 5; done
$SSH 'cd ~/crm && sudo docker compose ps'
echo
echo "Listo. Abre el hostname público que configuraste en el túnel (ej. https://crm.<dominio>)."
[ -z "$CF_AUD" ] && echo "AVISO: sin Cloudflare Access el CRM no tiene login. Configúralo y añade CF_ACCESS_TEAM/CF_ACCESS_AUD en ~/crm/.env, luego: cd ~/crm && sudo docker compose up -d"
echo "SSH: $SSH"

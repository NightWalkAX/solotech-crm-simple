#!/usr/bin/env bash
# Move the CRM to a bigger Lightsail plan (Lightsail can't resize in place). Run in AWS CloudShell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/NightWalkAX/solotech-crm-simple/main/deploy/lightsail-resize.sh)
# Stops the CRM on the old instance (only one tunnel connector may serve, or traffic splits between two DBs), snapshots
# it, creates the new instance from the snapshot, updates the code, starts it and closes port 80. The old instance is
# left STOPPED (not deleted) until you check the new one.
set -euo pipefail
ask() { local v; read -rp "$1 [$2]: " v; echo "${v:-$2}"; }

REGION=$(ask "Región AWS" "${AWS_REGION:-us-east-1}")
OLD=$(ask "Instancia actual" "crm")
NEW=$(ask "Nombre de la nueva" "${OLD}-4gb")
BUNDLE=$(ask "Plan nuevo (medium_3_0 = 4 GB ~US\$24, large_3_0 = 8 GB)" "medium_3_0")
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
KEY=~/.ssh/lightsail-$REGION.pem
if [ ! -s "$KEY" ]; then mkdir -p ~/.ssh; aws lightsail download-default-key-pair --query privateKeyBase64 --output text > "$KEY"; chmod 600 "$KEY"; fi
ip() { aws lightsail get-instance --instance-name "$1" --query 'instance.publicIpAddress' --output text; }
ssh_to() { local h=$1; shift; ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$h" "$@"; }

OLD_IP=$(ip "$OLD")
AZ=$(aws lightsail get-instance --instance-name "$OLD" --query 'instance.location.availabilityZone' --output text)
echo "1/6 Deteniendo el CRM en $OLD ($OLD_IP) para un snapshot consistente…"
ssh_to "$OLD_IP" 'cd ~/crm && sudo docker compose down'

SNAP="$OLD-$(date +%Y%m%d-%H%M)"
echo "2/6 Snapshot $SNAP (unos minutos)…"
aws lightsail stop-instance --instance-name "$OLD" >/dev/null
until [ "$(aws lightsail get-instance --instance-name "$OLD" --query 'instance.state.name' --output text)" = stopped ]; do sleep 5; done
aws lightsail create-instance-snapshot --instance-name "$OLD" --instance-snapshot-name "$SNAP" >/dev/null
until [ "$(aws lightsail get-instance-snapshot --instance-snapshot-name "$SNAP" --query 'instanceSnapshot.state' --output text)" = available ]; do sleep 10; done

echo "3/6 Creando $NEW ($BUNDLE) desde el snapshot…"
aws lightsail create-instances-from-snapshot --instance-snapshot-name "$SNAP" --instance-names "$NEW" \
  --availability-zone "$AZ" --bundle-id "$BUNDLE" >/dev/null
until [ "$(aws lightsail get-instance --instance-name "$NEW" --query 'instance.state.name' --output text)" = running ]; do sleep 5; done
NEW_IP=$(ip "$NEW")
aws lightsail close-instance-public-ports --instance-name "$NEW" --port-info fromPort=80,toPort=80,protocol=TCP >/dev/null || true
aws lightsail enable-add-on --resource-name "$NEW" \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=07:00}' >/dev/null || true

echo "4/6 Esperando SSH en $NEW_IP…"
until ssh_to "$NEW_IP" true 2>/dev/null; do sleep 5; done

echo "5/6 Actualizando el código y arrancando (la primera vez tarda 5-10 min)…"
ssh_to "$NEW_IP" 'cd ~/crm && git pull -q --no-rebase || echo "AVISO: git pull necesita merge, arranco con el código actual"
  grep -q "^WHISPER_MODEL=" .env || echo "WHISPER_MODEL=small" >> .env
  sudo docker compose up -d --build'

echo "6/6 Comprobando…"
for i in $(seq 1 60); do ssh_to "$NEW_IP" 'sudo docker compose -f ~/crm/docker-compose.yml exec -T crm curl -fsS localhost:8080/healthz' 2>/dev/null && break; sleep 5; done
ssh_to "$NEW_IP" 'cd ~/crm && sudo docker compose ps'
echo
echo "Listo: el CRM corre en $NEW ($NEW_IP). Pruébalo en tu dominio."
echo "La vieja ($OLD) quedó APAGADA. Cuando confirmes que todo está bien, bórrala:"
echo "  aws lightsail delete-instance --instance-name $OLD"
echo "SSH nuevo: ssh -i $KEY ubuntu@$NEW_IP"

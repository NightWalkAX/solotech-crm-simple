#!/usr/bin/env bash
# Move the CRM to a bigger Lightsail plan (Lightsail can't resize in place). Run in AWS CloudShell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/NightWalkAX/solotech-crm-simple/main/deploy/lightsail-resize.sh)
# RESUMABLE: every step checks the real state first, so if CloudShell drops just run it again with the same answers.
#  - old instance running  → stop the CRM, stop the instance, fresh snapshot
#  - old instance stopped  → reuse the newest "<old>-YYYYMMDD-HHMM" snapshot of the last 24 h (waits if still pending)
#  - new instance exists   → reuse it (waits until running)
#  - the build runs DETACHED on the new instance (nohup), so a CloudShell drop doesn't kill it; this script only polls.
# Only one tunnel connector may serve (else traffic splits between two DBs): the old one stays STOPPED, never deleted here.
set -euo pipefail
ask() { local v; read -rp "$1 [$2]: " v; echo "${v:-$2}"; }
say() { echo "[$(date +%H:%M:%S)] $*"; }

REGION=$(ask "Región AWS" "${AWS_REGION:-us-east-1}")
OLD=$(ask "Instancia actual" "crm")
NEW=$(ask "Nombre de la nueva" "${OLD}-4gb")
BUNDLE=$(ask "Plan nuevo (medium_3_0 = 4 GB ~US\$24, large_3_0 = 8 GB)" "medium_3_0")
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
KEY=~/.ssh/lightsail-$REGION.pem
if [ ! -s "$KEY" ]; then mkdir -p ~/.ssh; aws lightsail download-default-key-pair --query privateKeyBase64 --output text > "$KEY"; chmod 600 "$KEY"; fi

state() { aws lightsail get-instance --instance-name "$1" --query 'instance.state.name' --output text 2>/dev/null || echo none; }
ip() { aws lightsail get-instance --instance-name "$1" --query 'instance.publicIpAddress' --output text; }
ssh_to() { local h=$1; shift; ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=30 "ubuntu@$h" "$@"; }
wait_state() { # instance, wanted state
  local s; while :; do s=$(state "$1"); [ "$s" = "$2" ] && break; say "  $1: $s → esperando $2…"; sleep 10; done
}

NEW_STATE=$(state "$NEW")
OLD_STATE=$(state "$OLD")
say "Estado: $OLD = $OLD_STATE, $NEW = $NEW_STATE"

if [ "$NEW_STATE" = none ]; then
  [ "$OLD_STATE" = none ] && { echo "No existe la instancia $OLD en $REGION."; exit 1; }
  AZ=$(aws lightsail get-instance --instance-name "$OLD" --query 'instance.location.availabilityZone' --output text)

  # --- old instance: CRM down + instance stopped ---
  case "$OLD_STATE" in
    stopped) say "1/6 $OLD ya está apagada." ;;
    stopping) say "1/6 $OLD se está apagando…"; wait_state "$OLD" stopped ;;
    *)
      [ "$OLD_STATE" = running ] || wait_state "$OLD" running
      say "1/6 Deteniendo el CRM en $OLD y apagándola…"
      ssh_to "$(ip "$OLD")" 'cd ~/crm && sudo docker compose down' || say "  (no pude entrar por SSH; la apago igual)"
      aws lightsail stop-instance --instance-name "$OLD" >/dev/null
      wait_state "$OLD" stopped
      FRESH=1 ;;
  esac

  # --- snapshot: reuse a recent one of the stopped instance, unless we just stopped it ---
  SNAP=""
  if [ -z "${FRESH:-}" ]; then
    SINCE=$(date -u -d '24 hours ago' +%s)
    SNAP=$(aws lightsail get-instance-snapshots --output json | python3 -c "
import json, sys, datetime
old, since = sys.argv[1], int(sys.argv[2])
snaps = [s for s in json.load(sys.stdin)['instanceSnapshots']
         if s.get('fromInstanceName') == old and s['name'].startswith(old + '-') and s['state'] in ('available', 'pending')
         and datetime.datetime.fromisoformat(str(s['createdAt'])[:19]).replace(tzinfo=datetime.timezone.utc).timestamp() >= since]
snaps.sort(key=lambda s: str(s['createdAt']))
print(snaps[-1]['name'] if snaps else '')" "$OLD" "$SINCE")
  fi
  if [ -n "$SNAP" ]; then
    say "2/6 Reutilizo el snapshot $SNAP."
  else
    SNAP="$OLD-$(date +%Y%m%d-%H%M)"
    say "2/6 Creando snapshot $SNAP…"
    aws lightsail create-instance-snapshot --instance-name "$OLD" --instance-snapshot-name "$SNAP" >/dev/null
  fi
  while :; do
    S=$(aws lightsail get-instance-snapshot --instance-snapshot-name "$SNAP" --query 'instanceSnapshot.state' --output text)
    [ "$S" = available ] && break
    [ "$S" = error ] && { echo "El snapshot $SNAP falló. Bórralo en Lightsail y vuelve a correr el script."; exit 1; }
    say "  snapshot $SNAP: $S…"; sleep 15
  done

  say "3/6 Creando $NEW ($BUNDLE) desde $SNAP…"
  aws lightsail create-instances-from-snapshot --instance-snapshot-name "$SNAP" --instance-names "$NEW" \
    --availability-zone "$AZ" --bundle-id "$BUNDLE" >/dev/null
else
  say "1-3/6 $NEW ya existe: la reutilizo."
  if [ "$OLD_STATE" = running ]; then
    say "  OJO: $OLD sigue encendida. La apago para que no haya dos CRMs en el mismo túnel."
    ssh_to "$(ip "$OLD")" 'cd ~/crm && sudo docker compose down' || true
    aws lightsail stop-instance --instance-name "$OLD" >/dev/null || true
  fi
fi

[ "$(state "$NEW")" = stopped ] && aws lightsail start-instance --instance-name "$NEW" >/dev/null
wait_state "$NEW" running
NEW_IP=$(ip "$NEW")
aws lightsail close-instance-public-ports --instance-name "$NEW" --port-info fromPort=80,toPort=80,protocol=TCP >/dev/null 2>&1 || true
aws lightsail enable-add-on --resource-name "$NEW" \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=07:00}' >/dev/null 2>&1 || true

say "4/6 Esperando SSH en $NEW_IP…"
until ssh_to "$NEW_IP" true 2>/dev/null; do sleep 5; done

# Build + start detached on the instance (survives a CloudShell drop); skip if already healthy or already running.
HEALTH='sudo docker compose -f ~/crm/docker-compose.yml exec -T crm curl -fsS localhost:8080/healthz >/dev/null 2>&1'
if ssh_to "$NEW_IP" "grep -q UPDATE-OK ~/crm-update.log 2>/dev/null && $HEALTH"; then
  say "5/6 El CRM ya está actualizado y arriba en $NEW."
elif ssh_to "$NEW_IP" 'pgrep -f "docker compose u[p]" >/dev/null'; then
  say "5/6 La actualización ya está corriendo en $NEW; sigo su log."
else
  say "5/6 Actualizando el código y arrancando en segundo plano (5-10 min la primera vez)…"
  ssh_to "$NEW_IP" 'cd ~/crm && nohup sh -c "
      git pull -q --no-rebase || echo AVISO: git pull necesita merge, arranco con el codigo actual
      grep -q ^WHISPER_MODEL= .env || echo WHISPER_MODEL=small >> .env
      sudo docker compose up -d --build && echo UPDATE-OK || echo UPDATE-FAILED
    " > ~/crm-update.log 2>&1 < /dev/null &'
fi

say "6/6 Esperando a que responda (si CloudShell se cae, vuelve a correr el script: retoma aquí)…"
for i in $(seq 1 120); do
  ssh_to "$NEW_IP" "$HEALTH" && break
  if ssh_to "$NEW_IP" 'grep -q UPDATE-FAILED ~/crm-update.log 2>/dev/null'; then
    echo "Falló la actualización. Últimas líneas del log:"; ssh_to "$NEW_IP" 'tail -30 ~/crm-update.log'; exit 1
  fi
  say "  $(ssh_to "$NEW_IP" 'tail -1 ~/crm-update.log 2>/dev/null | cut -c1-100' || true)"
  sleep 10
done
ssh_to "$NEW_IP" 'cd ~/crm && sudo docker compose ps'
echo
say "Listo: el CRM corre en $NEW ($NEW_IP). Pruébalo en tu dominio."
echo "La vieja ($OLD) quedó APAGADA. Cuando confirmes que todo está bien, bórrala (y el snapshot si ya no lo quieres):"
echo "  aws lightsail delete-instance --instance-name $OLD"
echo "SSH nuevo: ssh -i $KEY ubuntu@$NEW_IP"

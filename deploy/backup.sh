#!/usr/bin/env bash
# Nightly consistent SQLite snapshot + files, kept 14 days. Cron on the instance:
#   15 3 * * * /home/ubuntu/crm/deploy/backup.sh >> /home/ubuntu/crm/backups/backup.log 2>&1
# Lightsail automatic snapshots (instance → Snapshots → Enable automatic) cover the whole disk on top of this.
set -euo pipefail
cd "$(dirname "$0")/.."
ts=$(date +%Y%m%d-%H%M)
mkdir -p backups
sqlite3 data/crm.sqlite ".backup backups/crm-$ts.sqlite"
sqlite3 "backups/crm-$ts.sqlite" "PRAGMA integrity_check;" | grep -qx ok
tar czf "backups/crm-$ts.tgz" -C backups "crm-$ts.sqlite" -C .. --exclude='data/crm.sqlite*' --exclude='data/chat-runs' data
rm "backups/crm-$ts.sqlite"
find backups -name 'crm-*.tgz' -mtime +14 -delete
echo "$ts ok"

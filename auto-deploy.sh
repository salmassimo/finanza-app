#!/bin/sh
# ============================================================
# Auto-deploy sul NAS (pull-based, no porte aperte).
# Pensato per il Task Scheduler di DSM (utente: root, ogni 5 min).
# Controlla l'ultimo commit su GitHub: se diverso da quello
# gia' deployato, scarica, ricostruisce e riavvia. Altrimenti esce.
# Preserva .env.prod e il volume del DB.
#
# Repo privato: metti un token (Contents: Read) in ~/.gh_token
# ============================================================
set -e

APP_DIR=/var/services/homes/sistema/finanza-app
REPO=salmassimo/finanza-app
BRANCH=master
TMP=/tmp/finanza_up
TOKEN_FILE=/var/services/homes/sistema/.gh_token
SHA_FILE=/var/services/homes/sistema/.finanza_sha
LOG=/var/services/homes/sistema/finanza-deploy.log

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }

# --- SHA del commit remoto ---
if [ -f "$TOKEN_FILE" ]; then
  REMOTE=$(curl -fsSL -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
    "https://api.github.com/repos/$REPO/commits/$BRANCH" \
    | grep -o '"sha": *"[0-9a-f]\{40\}"' | head -1 | grep -o '[0-9a-f]\{40\}')
else
  REMOTE=$(curl -fsSL "https://api.github.com/repos/$REPO/commits/$BRANCH" \
    | grep -o '"sha": *"[0-9a-f]\{40\}"' | head -1 | grep -o '[0-9a-f]\{40\}')
fi
[ -z "$REMOTE" ] && { log "ERRORE: SHA remoto non ottenuto"; exit 1; }

LOCAL=""
[ -f "$SHA_FILE" ] && LOCAL=$(cat "$SHA_FILE")

# Nessuna modifica -> esci silenziosamente
[ "$REMOTE" = "$LOCAL" ] && exit 0

log "Nuovo commit $REMOTE (precedente: ${LOCAL:-nessuno}) -> avvio deploy"

# --- Download ultima versione ---
rm -rf "$TMP" && mkdir -p "$TMP"
if [ -f "$TOKEN_FILE" ]; then
  curl -fsSL -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -o "$TMP/src.tar.gz" \
    "https://api.github.com/repos/$REPO/tarball/$BRANCH"
else
  curl -fsSL -o "$TMP/src.tar.gz" \
    "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
fi

tar xzf "$TMP/src.tar.gz" -C "$TMP"
SRC=$(find "$TMP" -maxdepth 1 -type d -name "*finanza-app*" | head -1)
[ -z "$SRC" ] && { log "ERRORE: sorgente non trovata"; exit 1; }

# --- Aggiorna codice (preserva .env.prod e dati) e ricostruisce ---
cp -rf "$SRC"/. "$APP_DIR"/
cd "$APP_DIR"
docker-compose --env-file .env.prod -f docker-compose.prod.yml up -d --build >> "$LOG" 2>&1
docker image prune -f >/dev/null 2>&1 || true

echo "$REMOTE" > "$SHA_FILE"
log "Deploy completato per $REMOTE"

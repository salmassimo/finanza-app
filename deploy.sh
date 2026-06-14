#!/bin/sh
# ============================================================
# Aggiornamento app sul NAS Synology (no git richiesto).
# Scarica l'ultima versione da GitHub, preserva .env.prod e i
# dati del DB (volume), ricostruisce e riavvia i container.
#
# Uso sul NAS:   sudo sh ~/deploy.sh
#
# Repo privato: crea il file /var/services/homes/sistema/.gh_token
# con dentro un token GitHub read-only (Contents: Read).
# Se il file non esiste, usa l'URL pubblico.
# ============================================================
set -e

APP_DIR=/var/services/homes/sistema/finanza-app
REPO=salmassimo/finanza-app
BRANCH=master
TMP=/tmp/finanza_up
TOKEN_FILE=/var/services/homes/sistema/.gh_token

echo ">> Scarico l'ultima versione ($BRANCH)..."
rm -rf "$TMP" && mkdir -p "$TMP"
if [ -f "$TOKEN_FILE" ]; then
  TK=$(cat "$TOKEN_FILE")
  curl -fsSL -H "Authorization: Bearer $TK" -o "$TMP/src.tar.gz" \
    "https://api.github.com/repos/$REPO/tarball/$BRANCH"
else
  curl -fsSL -o "$TMP/src.tar.gz" \
    "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
fi

echo ">> Estraggo..."
tar xzf "$TMP/src.tar.gz" -C "$TMP"
SRC=$(find "$TMP" -maxdepth 1 -type d -name "*finanza-app*" | head -1)
if [ -z "$SRC" ]; then echo "ERRORE: sorgente non trovata"; exit 1; fi

echo ">> Aggiorno il codice (preservo .env.prod e i dati)..."
cp -rf "$SRC"/. "$APP_DIR"/
cd "$APP_DIR"

echo ">> Rebuild + restart..."
docker-compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

echo ">> Pulizia immagini vecchie..."
docker image prune -f >/dev/null 2>&1 || true

echo ">> FATTO. Stato attuale:"
docker-compose -f docker-compose.prod.yml ps

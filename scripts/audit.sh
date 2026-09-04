#!/usr/bin/env bash
#
# npm audit, ami a registry kiesését nem minősíti kódhibának.
#
# Miért kell: az `npm audit` az advisory API-t hívja (nincs offline mód), és a
# végpont kiesésekor HTTP 503-cal, exit 1-gyel áll le — ugyanazzal a kilépési
# kóddal, amivel egy valódi sebezhetőség esetén. Így egy npm-oldali üzemzavar a
# teljes CI-t elbuktatja, miközben a kódban semmi nem változott (2026-09-04-én
# ez fél órán belül kétszer megtörtént). A kaput viszont nem szedjük le:
# **valódi találatra továbbra is hibázunk**, csak a hálózati/szolgáltatás-hibát
# tekintjük figyelmeztetésnek, a naplóban kimondva.
#
# A megkülönböztetés a kimenet szövegén megy, mert az `npm` nem ad külön
# kilépési kódot a kettőre. Ha a minta-lista bővül, itt kell bővíteni.
set -uo pipefail

LEVEL="${AUDIT_LEVEL:-moderate}"
ATTEMPTS="${AUDIT_ATTEMPTS:-3}"
SLEEP="${AUDIT_SLEEP:-20}"

# Csak szolgáltatás- és hálózati hiba; a "vulnerabilities" szövegű kimenet nem ide tartozik.
INFRA_PATTERN='audit endpoint returned an error|Service Unavailable|Internal Server Error|Bad Gateway|Gateway Time-?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|network'

for attempt in $(seq 1 "$ATTEMPTS"); do
  output="$(npm audit --audit-level="$LEVEL" 2>&1)"
  status=$?
  printf '%s\n' "$output"

  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if printf '%s' "$output" | grep -qiE "$INFRA_PATTERN"; then
    echo "::warning::Az npm audit végpont nem elérhető (kísérlet ${attempt}/${ATTEMPTS})."
    [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$SLEEP"
    continue
  fi

  echo "::error::Az npm audit sebezhetőséget talált (szint: ${LEVEL}) — ez blokkoló."
  exit 1
done

echo "::warning::Az npm audit végpontja mind a ${ATTEMPTS} kísérletnél elérhetetlen volt. A lépés nem hibázik, de a függőségek NEM lettek ellenőrizve — futtasd újra, ha a registry helyreállt."
exit 0

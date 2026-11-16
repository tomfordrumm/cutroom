#!/usr/bin/env bash
# End-to-end check through the API: log in, create a video, upload a recording,
# edit it, wait for the version and list its files.
#   scripts/smoke.sh path/to/recording.mov [http://localhost:8080]
set -euo pipefail
FILE="${1:?recording path}"
BASE="${2:-http://localhost:8080}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASSWORD="$(grep '^CUTROOM_PASSWORD=' "$DIR/.env" | cut -d= -f2-)"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(($1)(o))})"; }

curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"$PASSWORD\"}" "$BASE/api/login" >/dev/null
ID="$(curl -fsS -b "$JAR" -H 'content-type: application/json' -d '{"title":"Smoke test","brief":"Убрать паузы и дубли"}' "$BASE/api/videos" | json 'o=>o.id')"
echo "video $ID"
curl -fsS -b "$JAR" -T "$FILE" "$BASE/api/videos/$ID/sources?name=$(basename "$FILE")" >/dev/null
echo "uploaded $(basename "$FILE")"
curl -fsS -b "$JAR" -X POST "$BASE/api/videos/$ID/edit" >/dev/null
echo "editing…"
LAST=""
while true; do
  STATE="$(curl -fsS -b "$JAR" "$BASE/api/videos/$ID")"
  LINE="$(echo "$STATE" | json 'o=>[o.stage,o.job?.status,o.job?.step].join(" | ")')"
  [ "$LINE" != "$LAST" ] && echo "  $LINE" && LAST="$LINE"
  case "$LINE" in
    review*) break ;;
    *"| failed |"*|*"| cancelled |"*) echo "$STATE" | json 'o=>o.job.error'; exit 1 ;;
  esac
  sleep 2
done
echo "$STATE" | json 'o=>o.versions.map(v=>`${v.name}: ${v.durationSeconds?.toFixed(1)} s, removed ${v.removedSeconds?.toFixed(1)} s, files ${v.files.join(", ")}`).join("\n")'
echo "$STATE" | json 'o=>o.messages.map(m=>`[${m.role}] ${m.body}`).join("\n")'

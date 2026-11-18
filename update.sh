#!/usr/bin/env bash
# Update Cutroom in place. Run it from the install folder (next to compose.yml and .env):
#
#   sudo ./update.sh            the newest published version
#   sudo ./update.sh 0.3.0      a given version (also to go back)
#   sudo ./update.sh --now      do not wait for running edits: they are interrupted
#
# Videos, versions, settings and agent sign-ins live in the cutroom-data volume and stay.
# Running edits finish first; new ones wait in the queue and start after the restart.
# An install built from a checkout (install.sh --source) is rebuilt from that checkout:
# pull the code yourself, then run this script.
set -euo pipefail

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f compose.yml ] && [ -f .env ] || die "запустите из папки Cutroom, где лежат compose.yml и .env"
command -v docker >/dev/null || die "нет Docker"

NOW=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --now) NOW=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) die "неизвестный параметр $arg" ;;
    *) TARGET="${arg#v}" ;;
  esac
done

env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -q "^$1=" .env; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env >"$tmp" && cat "$tmp" >.env && rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >>.env
  fi
}
admin() { docker compose exec -T app node src/admin.js "$@"; }
field() { sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p"; }

IMAGE="$(env_get CUTROOM_IMAGE)"
BUILD=0
case "$(env_get COMPOSE_FILE)" in *compose.build.yml*) BUILD=1 ;; esac

# Images are compared by layers and creation time: a rebuild with build attestations
# gets a new id for the very same contents. The running one is read before it loses its tag.
fingerprint() { docker image inspect -f '{{json .RootFS.Layers}} {{.Created}}' "$1" 2>/dev/null || true; }
CONTAINER="$(docker compose ps -q app 2>/dev/null | head -1 || true)"
RUNNING="$([ -n "$CONTAINER" ] && fingerprint "$(docker inspect -f '{{.Image}}' "$CONTAINER")" || true)"

# ---- get the new image before touching anything ------------------------------
if [ "$BUILD" = 1 ]; then
  [ -z "$TARGET" ] || die "сборка из исходников: переключите версию в checkout (git checkout), без номера в update.sh"
  say "Собираю образ из исходников (контейнеры пока работают)"
  docker compose build
else
  [ -n "$IMAGE" ] || die "в .env нет CUTROOM_IMAGE"
  if [ -n "$TARGET" ]; then
    IMAGE="${IMAGE%:*}:$TARGET"
    set_env CUTROOM_IMAGE "$IMAGE"
  fi
  say "Скачиваю $IMAGE"
  docker pull "$IMAGE"
  # compose.yml and this script travel inside the image: take the new ones.
  for file in compose.yml update.sh .env.example; do
    docker run --rm --entrypoint cat "$IMAGE" "/opt/cutroom/release/$file" >"$file.new" 2>/dev/null || { rm -f "$file.new"; continue; }
    if cmp -s "$file" "$file.new"; then rm -f "$file.new"; else cp -p "$file" "$file.bak" 2>/dev/null || true; mv "$file.new" "$file"; fi
  done
  chmod +x update.sh
fi

# Same image as the running one: nothing to restart.
NEW="$(fingerprint "${IMAGE:-cutroom:local}")"
if [ -n "$RUNNING" ] && [ "$NEW" = "$RUNNING" ]; then
  say "Эта версия уже работает, перезапуск не нужен"
  exit 0
fi

# ---- let running edits finish -------------------------------------------------
if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  admin pause "Обновление Cutroom" >/dev/null
  trap 'admin resume >/dev/null 2>&1 || true; echo "Прервано: очередь снова работает, версия не изменилась."' INT TERM
  if [ "$NOW" = 0 ]; then
    waited=0
    while true; do
      status="$(admin status)"
      running="$(printf '%s' "$status" | field running)"
      [ "${running:-0}" = 0 ] && break
      [ $((waited % 60)) = 0 ] && say "Идёт монтаж ($running). Жду, пока закончится; новые ждут в очереди. Ctrl+C — отменить обновление."
      sleep 10; waited=$((waited + 10))
    done
  else
    say "--now: идущий монтаж прервётся, его можно будет запустить снова"
  fi
  trap - INT TERM
fi

# ---- restart on the new image -------------------------------------------------
say "Перезапускаю Cutroom"
docker compose up -d --remove-orphans
for _ in $(seq 1 60); do
  if docker compose exec -T app curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    # The new worker resumes the queue itself; this covers a worker that was not recreated.
    say "Готово: $(admin resume | sed -n 's/.*"version":"\([^"]*\)".*/Cutroom \1/p')"
    exit 0
  fi
  sleep 2
done
die "Cutroom не ответил после перезапуска: docker compose logs app"

#!/usr/bin/env bash
# Cutroom installer.
#
#   Published image (Docker already installed: the installer travels inside the image):
#     docker run --rm --entrypoint cat ghcr.io/tomfordrumm/cutroom:latest /opt/cutroom/release/install.sh | sudo bash -s -- --domain cut.example.com
#   Or with this file at hand (installs Docker on Linux if missing):
#     sudo bash install.sh --domain cut.example.com
#   Local test from a checkout (builds the image here):
#     ./install.sh --source . --orc ../VideoEditor
#
# Re-running is safe: the existing .env (password, secret) and all data volumes are kept.
# Updates: ./update.sh in the install folder (it waits for running edits).
set -euo pipefail

SOURCE=""
INSTALL_DIR=""
DOMAIN=""
PORT="8080"
ORC_PATH=""
DEFAULT_IMAGE="ghcr.io/tomfordrumm/cutroom:latest"
IMAGE="${CUTROOM_IMAGE:-}"

usage() {
  cat <<'EOF'
Usage: install.sh [options]
  --source DIR   build the image from a Cutroom checkout (local test / development)
  --orc DIR      OpenRoughCut checkout for --source builds (default: ../VideoEditor next to the source)
  --dir DIR      where to keep compose.yml and .env (default: the source dir, or /opt/cutroom)
  --domain NAME  public domain; enables HTTPS through Caddy (point DNS at this server first)
  --port N       local port of the web interface (default 8080)
  --image REF    published image (default ghcr.io/tomfordrumm/cutroom:latest); :X.Y.Z pins a version
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --orc) ORC_PATH="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# A checkout next to the script counts as --source when run as a file.
if [ -z "$SOURCE" ] && [ -z "$IMAGE" ] && [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/compose.build.yml" ]; then
  SOURCE="$(dirname "${BASH_SOURCE[0]}")"
fi

# ---- Docker -----------------------------------------------------------------
OS="$(uname -s)"
if ! command -v docker >/dev/null 2>&1; then
  if [ "$OS" = "Linux" ]; then
    [ "$(id -u)" -eq 0 ] || die "Docker is missing. Run the installer with sudo so it can install Docker."
    say "Installing Docker"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker >/dev/null 2>&1 || true
  else
    die "Docker is missing. Install Docker Desktop (https://www.docker.com/products/docker-desktop/) and run this again."
  fi
fi
docker info >/dev/null 2>&1 || die "Docker is installed but not running (start Docker Desktop or the docker service)."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose …)."

# ---- files ------------------------------------------------------------------
if [ -n "$SOURCE" ]; then
  SOURCE="$(cd "$SOURCE" && pwd)"
  [ -f "$SOURCE/compose.build.yml" ] || die "$SOURCE is not a Cutroom checkout."
  INSTALL_DIR="${INSTALL_DIR:-$SOURCE}"
  ORC_PATH="${ORC_PATH:-$SOURCE/../VideoEditor}"
  ORC_PATH="$(cd "$ORC_PATH" 2>/dev/null && pwd)" || die "OpenRoughCut checkout not found; pass --orc DIR."
  [ -f "$ORC_PATH/packages/core/src/pipeline.js" ] || die "$ORC_PATH has no packages/core (needs the core/cli/desktop split)."
else
  IMAGE="${IMAGE:-$DEFAULT_IMAGE}"
  INSTALL_DIR="${INSTALL_DIR:-/opt/cutroom}"
fi
mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
cd "$INSTALL_DIR"
if [ -z "$SOURCE" ]; then
  say "Pulling $IMAGE"
  docker pull "$IMAGE" || die "Could not pull $IMAGE. A private image needs: docker login ghcr.io"
  # compose.yml, update.sh and .env.example ship inside the image.
  for file in compose.yml update.sh .env.example; do
    docker run --rm --entrypoint cat "$IMAGE" "/opt/cutroom/release/$file" >"$file.new" || die "$IMAGE has no $file"
    mv "$file.new" "$file"
  done
  chmod +x update.sh
fi

random() { # no early-closing pipe: with pipefail a SIGPIPE would abort the script
  local chars; chars="$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  printf '%s' "${chars:0:$1}"
}
set_env() { # key value: replace or append in .env
  if grep -q "^$1=" .env; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env >"$tmp" && mv "$tmp" .env
  else
    printf '%s=%s\n' "$1" "$2" >>.env
  fi
}

NEW_PASSWORD=""
if [ ! -f .env ]; then
  say "Creating .env"
  NEW_PASSWORD="$(random 20)"
  cat >.env <<EOF
# Cutroom settings. Apply changes with: docker compose up -d
CUTROOM_PASSWORD=$NEW_PASSWORD
CUTROOM_SECRET=$(random 48)
EOF
  chmod 600 .env
fi
set_env CUTROOM_PORT "$PORT"
if [ -n "$DOMAIN" ]; then
  set_env CUTROOM_DOMAIN "$DOMAIN"
  set_env COMPOSE_PROFILES https
  set_env CUTROOM_BIND 127.0.0.1
else
  grep -q '^CUTROOM_BIND=' .env || set_env CUTROOM_BIND 127.0.0.1
fi
if [ -n "$SOURCE" ]; then
  set_env COMPOSE_FILE "compose.yml:compose.build.yml"
  set_env ORC_PATH "$ORC_PATH"
  set_env CUTROOM_IMAGE "cutroom:local"
else
  set_env CUTROOM_IMAGE "$IMAGE"
fi
set_env CUTROOM_INSTALL_DIR "$INSTALL_DIR"

# ---- start ------------------------------------------------------------------
if [ -n "$SOURCE" ]; then
  say "Building the image (first build takes a few minutes: whisper.cpp, FFmpeg, agents)"
  docker compose build
else
  say "Pulling the rest (Caddy for HTTPS)"
  docker compose pull --ignore-pull-failures --quiet caddy 2>/dev/null || true
fi
say "Starting Cutroom"
docker compose up -d

say "Waiting for the web app"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    URL="http://localhost:$PORT"
    [ -n "$DOMAIN" ] && URL="https://$DOMAIN"
    echo
    printf '\033[32m✓ Cutroom is running: %s\033[0m\n' "$URL"
    if [ -n "$NEW_PASSWORD" ]; then
      echo "  Password: $NEW_PASSWORD   (stored in $INSTALL_DIR/.env)"
    else
      echo "  Password: CUTROOM_PASSWORD in $INSTALL_DIR/.env"
    fi
    echo "  Logs:     cd $INSTALL_DIR && docker compose logs -f"
    echo "  Update:   cd $INSTALL_DIR && sudo ./update.sh   (Settings shows when a new version is out)"
    echo "  The first edit downloads the Whisper model (~470 MB)."
    exit 0
  fi
  sleep 2
done
die "The app did not answer on port $PORT. Check: cd $INSTALL_DIR && docker compose logs app"

#!/usr/bin/env bash
#
# HomeLine — one-command server installer for a fresh Ubuntu host.
#
# Usage (interactive):
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install.sh | sudo bash
#
# Or clone first and run:
#   sudo bash scripts/install.sh
#
# What it does:
#   1. Installs Docker Engine + Compose plugin (if missing).
#   2. Clones (or updates) the repo into /opt/homeline.
#   3. Generates a .env with a strong DB password + encryption key (idempotent —
#      keeps existing values on re-run so you don't lose the encryption key).
#   4. Builds and starts the stack.
#   5. Prints the URL and the seeded God-mode login.
#
set -euo pipefail

# ---- Config (override via environment) -------------------------------------
REPO_URL="${HOMELINE_REPO:-https://github.com/sidestreetmedia/homeline.git}"
BRANCH="${HOMELINE_BRANCH:-main}"
INSTALL_DIR="${HOMELINE_DIR:-/opt/homeline}"
HTTP_PORT="${HOMELINE_PORT:-8080}"

log()  { printf '\033[1;36m[homeline]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[homeline]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[homeline]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (use sudo)."

# ---- 1. OS check -----------------------------------------------------------
if [ -r /etc/os-release ]; then . /etc/os-release; fi
if [ "${ID:-}" != "ubuntu" ]; then
  warn "This installer targets Ubuntu. Detected '${ID:-unknown}' — continuing anyway."
fi

export DEBIAN_FRONTEND=noninteractive

# ---- 2. Docker -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine + Compose plugin..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME:-noble} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker already present: $(docker --version)"
  command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }
fi

# Pick the compose command (plugin preferred).
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Docker Compose not available after install."
fi

# ---- 3. Fetch the code -----------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing checkout in $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
elif [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  log "Using existing project already present in $INSTALL_DIR (no git repo)."
else
  log "Cloning $REPO_URL ($BRANCH) into $INSTALL_DIR..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---- 4. Generate .env (idempotent) -----------------------------------------
# Helper: read an existing value from .env, else generate, and persist it.
ENV_FILE="$INSTALL_DIR/.env"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

get_or_set() {  # name  generator-cmd
  local name="$1" gen="$2" cur
  cur="$(grep -E "^${name}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  if [ -n "$cur" ]; then
    printf '%s' "$cur"
  else
    local val; val="$(eval "$gen")"
    printf '%s=%s\n' "$name" "$val" >> "$ENV_FILE"
    printf '%s' "$val"
  fi
}

log "Preparing environment file ($ENV_FILE)..."
get_or_set DB_PASS 'openssl rand -hex 24' >/dev/null
get_or_set DB_ROOT_PASS 'openssl rand -hex 24' >/dev/null
get_or_set CONFIG_ENCRYPTION_KEY 'openssl rand -base64 32' >/dev/null
# First-boot flags (only added if not present).
grep -qE '^AUTO_MIGRATE=' "$ENV_FILE" || echo 'AUTO_MIGRATE=1' >> "$ENV_FILE"
grep -qE '^SEED_GOD='     "$ENV_FILE" || echo 'SEED_GOD=1'     >> "$ENV_FILE"

# ---- 5. Build & start ------------------------------------------------------
log "Building and starting containers (this can take a few minutes the first time)..."
$COMPOSE --env-file "$ENV_FILE" up -d --build

# ---- 6. Wait for health ----------------------------------------------------
log "Waiting for the app to respond on port ${HTTP_PORT}..."
ok=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/" || true)"
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then ok=1; break; fi
  sleep 3
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
if [ "$ok" = "1" ]; then
  log "HomeLine is up."
else
  warn "App did not return 200/302 yet. Check logs: $COMPOSE logs -f app"
fi
cat <<MSG

  ──────────────────────────────────────────────────────────────
   HomeLine installed in: $INSTALL_DIR
   Local URL:    http://127.0.0.1:${HTTP_PORT}/
   LAN URL:      http://${IP:-<server-ip>}:${HTTP_PORT}/

   God-mode login:  joshuakuhn
   Temp password:   see $INSTALL_DIR/INITIAL_GOD_PASSWORD.txt (if present)
                    or reset:  $COMPOSE exec app php cron/make_god.php joshuakuhn --name="Joshua Kuhn"

   NEXT STEPS
     1. Put this behind HTTPS (reverse proxy or Cloudflare Tunnel) and
        set APP_BASE_URL in God-mode → App keys & config.
     2. Enter your Telnyx / ElevenLabs / Stripe / AWS keys in the portal.
        (They're stored encrypted with the key in $ENV_FILE — back that up.)

   Manage:   cd $INSTALL_DIR && $COMPOSE ps | logs -f | down
  ──────────────────────────────────────────────────────────────

MSG

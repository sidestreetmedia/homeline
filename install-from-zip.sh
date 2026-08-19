#!/usr/bin/env bash
#
# HomeLine — install from a packaged zip on GitHub (no git clone required).
#
# Pulls the stable installer release from GitHub, verifies its checksum,
# unpacks it, generates secrets, and brings the Docker stack up on a fresh
# Ubuntu host.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sidestreetmedia/homeline/main/install-from-zip.sh | sudo bash
#
# Token-authenticated custom URL? Pass the token through the environment:
#   GITHUB_TOKEN=github_pat_xxx sudo -E bash install-from-zip.sh
#
set -euo pipefail

# ---- Config (override via environment) -------------------------------------
# NOTE: this is a direct download URL, not a github.com/.../blob/... HTML page.
ZIP_URL="${HOMELINE_ZIP_URL:-https://github.com/sidestreetmedia/homeline/releases/download/installer-latest/homeline-install.zip}"
CHECKSUM_URL="${HOMELINE_CHECKSUM_URL:-${ZIP_URL}.sha256}"
SKIP_CHECKSUM="${HOMELINE_SKIP_CHECKSUM:-0}"
INSTALL_DIR="${HOMELINE_DIR:-/opt/homeline}"
HTTP_PORT="${HOMELINE_PORT:-8080}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

log()  { printf '\033[1;36m[homeline]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[homeline]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[homeline]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (use sudo)."

if [ -r /etc/os-release ]; then . /etc/os-release; fi
[ "${ID:-}" = "ubuntu" ] || warn "Targets Ubuntu; detected '${ID:-unknown}'. Continuing."

export DEBIAN_FRONTEND=noninteractive

# ---- 1. Base packages ------------------------------------------------------
log "Ensuring curl, unzip, ca-certificates, gnupg, and openssl are present..."
apt-get update -y
apt-get install -y curl unzip ca-certificates gnupg openssl

# ---- 2. Docker (install if missing) ----------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine + Compose plugin..."
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
  log "Docker present: $(docker --version)"
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Docker Compose not available."
fi

# ---- 3. Download the zip ----------------------------------------------------
TMP_ZIP="$(mktemp --suffix=.zip)"
TMP_CHECKSUM="$(mktemp)"
trap 'rm -f "$TMP_ZIP" "$TMP_CHECKSUM"' EXIT

log "Downloading package from: $ZIP_URL"
AUTH_ARGS=()
if [ -n "$GITHUB_TOKEN" ]; then
  # Used for token-authenticated custom package URLs.
  AUTH_ARGS=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

HTTP_CODE="$(curl -fL -sS -w '%{http_code}' "${AUTH_ARGS[@]}" -o "$TMP_ZIP" "$ZIP_URL" || true)"
if [ "$HTTP_CODE" != "200" ]; then
  die "Download failed (HTTP ${HTTP_CODE:-?}). If the repo is private, pass GITHUB_TOKEN. \
If you copied a github.com/.../blob/... link, use the raw URL instead."
fi

# Verify it's actually a zip (PK magic bytes), not an HTML error page.
if ! head -c 2 "$TMP_ZIP" | grep -q 'PK'; then
  warn "Downloaded file does not look like a zip. First bytes:"
  head -c 200 "$TMP_ZIP" >&2; echo >&2
  die "Refusing to continue — the URL probably returned a web page, not the zip."
fi
if ! unzip -tq "$TMP_ZIP" >/dev/null 2>&1; then
  die "Downloaded zip failed integrity check."
fi

if [ "$SKIP_CHECKSUM" = "1" ]; then
  warn "Skipping SHA-256 verification because HOMELINE_SKIP_CHECKSUM=1."
else
  log "Downloading checksum from: $CHECKSUM_URL"
  CHECKSUM_HTTP_CODE="$(curl -fL -sS -w '%{http_code}' "${AUTH_ARGS[@]}" \
    -o "$TMP_CHECKSUM" "$CHECKSUM_URL" || true)"
  if [ "$CHECKSUM_HTTP_CODE" != "200" ]; then
    die "Checksum download failed (HTTP ${CHECKSUM_HTTP_CODE:-?}). Set HOMELINE_SKIP_CHECKSUM=1 only if you trust a custom package URL."
  fi

  EXPECTED_SHA="$(awk 'NR == 1 { print $1 }' "$TMP_CHECKSUM")"
  case "$EXPECTED_SHA" in
    ''|*[!0-9a-fA-F]*) die "Published checksum is malformed." ;;
  esac
  [ "${#EXPECTED_SHA}" -eq 64 ] || die "Published checksum is malformed."

  ACTUAL_SHA="$(sha256sum "$TMP_ZIP" | awk '{ print $1 }')"
  [ "${ACTUAL_SHA,,}" = "${EXPECTED_SHA,,}" ] || die "Package checksum mismatch; refusing to install."
fi
log "Package downloaded and verified."

# ---- 4. Unpack --------------------------------------------------------------
mkdir -p "$INSTALL_DIR"
log "Unpacking into $INSTALL_DIR..."
# Stage to a temp dir so we can handle zips that contain a top-level folder.
STAGE="$(mktemp -d)"
PRESERVED_ENV=""
trap 'rm -f "$TMP_ZIP" "$TMP_CHECKSUM" "${PRESERVED_ENV:-}"; rm -rf "$STAGE"' EXIT
unzip -q -o "$TMP_ZIP" -d "$STAGE"

# If the zip has a single top-level directory, descend into it.
SRC="$STAGE"
entries=("$STAGE"/*)
if [ "${#entries[@]}" -eq 1 ] && [ -d "${entries[0]}" ]; then
  SRC="${entries[0]}"
fi
[ -f "$SRC/docker-compose.yml" ] || die "Unpacked archive is missing docker-compose.yml (unexpected contents)."

# The official package excludes .env, but preserve it explicitly so an upgrade
# cannot replace database credentials or the encryption key even if a future or
# custom package accidentally contains one.
if [ -e "$INSTALL_DIR/.env" ]; then
  [ -f "$INSTALL_DIR/.env" ] || die "Existing $INSTALL_DIR/.env is not a regular file; refusing to replace it."
  PRESERVED_ENV="$(mktemp)"
  cp -p "$INSTALL_DIR/.env" "$PRESERVED_ENV"
  log "Preserving existing .env and database-backed application keys."
fi

cp -a "$SRC"/. "$INSTALL_DIR"/

if [ -n "$PRESERVED_ENV" ]; then
  cp -p "$PRESERVED_ENV" "$INSTALL_DIR/.env"
fi
cd "$INSTALL_DIR"

# ---- 5. Generate .env (idempotent) -----------------------------------------
ENV_FILE="$INSTALL_DIR/.env"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

get_or_set() {  # name  generator-cmd  -> appends to .env if absent
  local name="$1" gen="$2" cur
  cur="$(grep -E "^${name}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  if [ -z "$cur" ]; then
    printf '%s=%s\n' "$name" "$(eval "$gen")" >> "$ENV_FILE"
  fi
}

log "Preparing environment file ($ENV_FILE)..."
get_or_set DB_PASS 'openssl rand -hex 24'
get_or_set DB_ROOT_PASS 'openssl rand -hex 24'
get_or_set CONFIG_ENCRYPTION_KEY 'openssl rand -base64 32'
grep -qE '^AUTO_MIGRATE=' "$ENV_FILE" || echo 'AUTO_MIGRATE=1' >> "$ENV_FILE"
grep -qE '^SEED_GOD='     "$ENV_FILE" || echo 'SEED_GOD=1'     >> "$ENV_FILE"
log "Existing MySQL volume and God-mode API keys will be reused."

# ---- 6. Build & start -------------------------------------------------------
log "Building and starting containers (first run can take a few minutes)..."
$COMPOSE --env-file "$ENV_FILE" up -d --build

# ---- 7. Health check --------------------------------------------------------
log "Waiting for the app on port ${HTTP_PORT}..."
ok=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/" || true)"
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then ok=1; break; fi
  sleep 3
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
[ "$ok" = "1" ] && log "HomeLine is up." || warn "App not responding yet — check: $COMPOSE logs -f app"
cat <<MSG

  ──────────────────────────────────────────────────────────────
   Installed in: $INSTALL_DIR
   Local URL:    http://127.0.0.1:${HTTP_PORT}/
   LAN URL:      http://${IP:-<server-ip>}:${HTTP_PORT}/

   God login:    joshuakuhn
   Password:     reset it now (the package omits the plaintext file):
                 $COMPOSE exec app php cron/make_god.php joshuakuhn --name="Joshua Kuhn"

   Next: put it behind HTTPS, set APP_BASE_URL and your API keys in
   God-mode -> App keys & config. Back up $ENV_FILE (it holds your
   CONFIG_ENCRYPTION_KEY).
  ──────────────────────────────────────────────────────────────

MSG

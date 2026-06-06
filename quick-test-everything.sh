#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# quick-test-everything.sh — Start all Sideops services for local testing
# ────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGS_DIR="$ROOT_DIR/.quick-test-logs"
PID_FILE="$LOGS_DIR/.pids"
mkdir -p "$LOGS_DIR"

# ─── Defaults ──────────────────────────────────────────────────────────────
STORAGE=""
REDIS_SOURCE=""         # local | url | existing
REDIS_URL="redis://localhost:6379"
REDIS_URL_EXPLICIT=false    # tracks whether --redis-url was passed
USE_DOCKER=true

# AWS config (used when --storage aws)
AWS_ACCESS_KEY=""
AWS_SECRET_KEY=""
AWS_BUCKET=""
AWS_REGION="us-east-1"

# Docker container names
DOCKER_REDIS="sideops-redis"
DOCKER_MINIO="sideops-minio"

# ─── Colors ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "  ${BLUE}ℹ${NC} $*"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "  ${RED}✗${NC} $*"; }
header(){ echo -e "\n${BOLD}── $* ──${NC}"; }

# ─── Help ──────────────────────────────────────────────────────────────────
usage() {
  cat <<'EOFUSAGE'
Usage: quick-test-everything.sh [options]

Start all Sideops services for local testing.

Storage options (required):
  --storage minio         Use MinIO (auto-configured via Docker, no AWS needed)
  --storage aws           Use AWS S3 (you provide credentials)

Redis options:
  --redis local           Start Redis via Docker (default)
  --redis url             Use an existing Redis URL
  --redis-url <url>       Redis URL (required with --redis url)
                          Default: redis://localhost:6379

Docker options:
  --no-docker             Skip Docker entirely (you manage Redis/MinIO manually)

AWS-specific (only with --storage aws):
  --aws-access-key <key>  AWS access key ID
  --aws-secret-key <key>  AWS secret access key
  --aws-bucket <name>     S3 bucket name
  --aws-region <region>   AWS region (default: us-east-1)

Management:
  --stop                  Stop all running services and Docker containers

Other:
  --help, -h              Show this help

Examples:
  quick-test-everything.sh --storage minio --redis local
  quick-test-everything.sh --storage aws --redis url --redis-url redis://my-redis:6379 \
    --aws-access-key AKIAxxx --aws-secret-key xxx --aws-bucket my-bucket
EOFUSAGE
  exit 0
}

# ─── Parse arguments ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --storage)        shift; STORAGE="$1" ;;
    --redis)          shift; REDIS_SOURCE="$1" ;;
    --redis-url)      shift; REDIS_URL="$1"; REDIS_URL_EXPLICIT=true ;;
    --aws-access-key) shift; AWS_ACCESS_KEY="$1" ;;
    --aws-secret-key) shift; AWS_SECRET_KEY="$1" ;;
    --aws-bucket)     shift; AWS_BUCKET="$1" ;;
    --aws-region)     shift; AWS_REGION="$1" ;;
    --no-docker)      USE_DOCKER=false ;;
    --stop)           DO_STOP=true ;;
    --help|-h)        usage ;;
    *)                echo -e "${RED}Error: Unknown argument: $1${NC}" >&2; usage ;;
  esac
  shift
done

# ─── Stop mode ────────────────────────────────────────────────────────────
# If --stop is passed, kill all services and stop Docker containers, then exit.
if [[ "${DO_STOP:-false}" == "true" ]]; then
  header "Stopping everything"

  # Kill background Node.js processes from PID file
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        ok "Stopped PID $pid"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  else
    info "No PID file found at $PID_FILE — no Node services tracked"
  fi

  # Also try to find and kill any remaining node/vite processes on our service ports
  leftover=$(lsof -ti:3001 -ti:8080 -ti:5173 2>/dev/null || true)
  if [[ -n "$leftover" ]]; then
    # shellcheck disable=SC2086
    kill $leftover 2>/dev/null || true
    ok "Freed remaining processes on ports 3001, 8080, 5173"
  fi

  # Stop Docker containers
  if command -v docker &>/dev/null; then
    for container in "$DOCKER_REDIS" "$DOCKER_MINIO"; do
      if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        docker rm -f "$container" >/dev/null 2>&1 || true
        ok "Removed Docker container $container"
      fi
    done
  fi

  # Clean up log directory
  if [[ -d "$LOGS_DIR" ]]; then
    rm -rf "$LOGS_DIR"
    ok "Removed .quick-test-logs/"
  fi

  echo ""
  ok "All services stopped."
  exit 0
fi

# ─── Validate ──────────────────────────────────────────────────────────────
if [[ -z "$STORAGE" ]]; then
  echo -e "${RED}Error: --storage is required (minio or aws)${NC}" >&2
  usage
fi
if [[ "$STORAGE" != "minio" && "$STORAGE" != "aws" ]]; then
  echo -e "${RED}Error: --storage must be 'minio' or 'aws'${NC}" >&2
  exit 1
fi

# Default redis source
if [[ -z "$REDIS_SOURCE" ]]; then
  if $USE_DOCKER; then
    REDIS_SOURCE="local"
  else
    REDIS_SOURCE="existing"
  fi
fi

if [[ "$REDIS_SOURCE" != "local" && "$REDIS_SOURCE" != "url" && "$REDIS_SOURCE" != "existing" ]]; then
  echo -e "${RED}Error: --redis must be 'local' or 'url'${NC}" >&2
  exit 1
fi
if [[ "$REDIS_SOURCE" == "url" && "$REDIS_URL_EXPLICIT" == "false" ]]; then
  echo -e "${RED}Error: --redis-url is required when --redis url${NC}" >&2
  usage
fi
if [[ "$STORAGE" == "aws" && $USE_DOCKER == false && "$REDIS_SOURCE" != "url" && "$REDIS_SOURCE" != "existing" ]]; then
  echo -e "${RED}Error: --no-docker requires --redis url or you must have Redis running on localhost:6379${NC}" >&2
  exit 1
fi

# ─── Prerequisites ─────────────────────────────────────────────────────────
header "Checking prerequisites"

command -v node >/dev/null 2>&1 || { fail "node is not installed"; exit 1; }
ok "node $(node -v)"

# Node --watch requires Node.js 18+
NODE_MAJOR=$(node -e "console.log(process.version.slice(1).split('.')[0])" 2>/dev/null || echo 0)
if [[ $NODE_MAJOR -lt 18 ]]; then
  warn "Node.js 18+ required for --watch flag (detected: Node $(node -v)). Services won't auto-reload."
fi

if $USE_DOCKER; then
  if command -v docker >/dev/null 2>&1; then
    ok "docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
  else
    fail "docker is not installed (use --no-docker to skip)"
    exit 1
  fi
fi

# Check for netcat (used for port-waiting)
NC_AVAILABLE=false
command -v nc >/dev/null 2>&1 && NC_AVAILABLE=true

# ─── Helper: wait for a TCP port ──────────────────────────────────────────
wait_for_port() {
  local host="$1" port="$2" name="$3" timeout="${4:-45}"
  local elapsed=0
  while true; do
    if $NC_AVAILABLE; then
      nc -z "$host" "$port" 2>/dev/null && return 0
    else
      # bash /dev/tcp fallback
      timeout 1 bash -c "echo > /dev/tcp/$host/$port" 2>/dev/null && return 0
    fi
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      return 1
    fi
    sleep 1
  done
}

# ─── Helper: manage Docker containers ─────────────────────────────────────
# Usage: docker_ensure_running <name> <image> <docker_opts> [cmd]
#   docker_opts: all Docker flags like -p, -e, -v (BEFORE the image)
#   cmd:         the CMD string passed to the container (AFTER the image)
docker_ensure_running() {
  local name="$1" image="$2" docker_opts="$3" cmd="${4:-}"
  if docker ps --format '{{.Names}}' | grep -q "^${name}$"; then
    ok "$name is already running"
    return 0
  fi
  # Remove a stopped container with the same name
  docker rm -f "$name" 2>/dev/null || true
  info "Starting $name ..."
  # shellcheck disable=SC2086
  docker run -d --name "$name" $docker_opts "$image" $cmd >/dev/null
  ok "$name started"
}

# ─── Helper: npm install if needed ────────────────────────────────────────
ensure_deps() {
  local dir="$1" label="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    info "Installing $label dependencies ..."
    (cd "$dir" && npm install --silent) || {
      fail "npm install failed in $label"
      return 1
    }
    ok "$label dependencies installed"
  else
    ok "$label dependencies OK"
  fi
}

# ─── Helper: write .env file ────────────────────────────────────────────────
write_env() {
  local file="$1"
  cat > "$file"
}

# ─── Start dependencies ───────────────────────────────────────────────────
header "Starting dependencies"

# --- Redis ---
if [[ "$REDIS_SOURCE" == "local" ]] && $USE_DOCKER; then
  docker_ensure_running "$DOCKER_REDIS" "redis:alpine" "-p 6379:6379"
  REDIS_URL="redis://localhost:6379"
  info "Waiting for Redis ..."
  wait_for_port "localhost" "6379" "Redis" 30 || {
    fail "Redis did not start in time. Check: docker logs $DOCKER_REDIS"
    exit 1
  }
  ok "Redis ready at $REDIS_URL"
elif [[ "$REDIS_SOURCE" == "url" ]]; then
  info "Using external Redis at $REDIS_URL"
  # Quick connectivity check
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -u "$REDIS_URL" PING 2>/dev/null | grep -q "PONG" \
      && ok "Redis reachable" \
      || warn "Could not reach Redis — continuing anyway"
  fi
elif [[ "$REDIS_SOURCE" == "existing" ]]; then
  info "Assuming Redis is already running on localhost:6379"
fi

# --- MinIO (if selected) ---
if [[ "$STORAGE" == "minio" ]] && $USE_DOCKER; then
  docker_ensure_running "$DOCKER_MINIO" "quay.io/minio/minio" \
    "-p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin" \
    "server /data --console-address :9001"

  info "Waiting for MinIO API (port 9000) ..."
  wait_for_port "localhost" "9000" "MinIO" 30 || {
    fail "MinIO did not start in time. Check: docker logs $DOCKER_MINIO"
    exit 1
  }

  # Port is open but the S3 API may not be fully ready yet — poll the health endpoint
  info "Waiting for MinIO to be fully ready ..."
  for _i in $(seq 1 30); do
    curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1 && break
    sleep 1
  done
  ok "MinIO API ready at http://localhost:9000"

  # --- Bucket creation helper ---
  _minio_setup_mc() {
    mc alias set myminio http://localhost:9000 minioadmin minioadmin || return 1
    mc mb --ignore-existing myminio/sideops                          || return 1
    mc anonymous set public myminio/sideops                          || return 1
  }

  if command -v mc &>/dev/null && _minio_setup_mc; then
    ok "MinIO bucket 'sideops' created and set to public-read (mc)"
  elif command -v aws &>/dev/null; then
    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
      aws s3api create-bucket --bucket sideops --endpoint-url http://localhost:9000 2>/dev/null || true
    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
      aws s3api put-bucket-policy --bucket sideops --endpoint-url http://localhost:9000 --policy '{
        "Version":"2012-10-17",
        "Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::sideops/*"}]
      }' 2>/dev/null \
    && ok "MinIO bucket 'sideops' created and set to public-read (aws cli)" \
    || warn "Could not set bucket policy — set manually"
  else
    # No mc or aws installed locally — use a temporary mc Docker container
    info "No mc/aws found — using Docker mc image to configure MinIO ..."
    docker run --rm --network host quay.io/minio/mc \
      sh -c "mc alias set m http://localhost:9000 minioadmin minioadmin \
          && mc mb --ignore-existing m/sideops \
          && mc anonymous set public m/sideops" \
    && ok "MinIO bucket 'sideops' created and set to public-read (mc container)" \
    || {
      warn "Auto-configure failed. Do it manually at http://localhost:9001 (minioadmin/minioadmin):"
      warn "  1. Create bucket named 'sideops'"
      warn "  2. Bucket → Anonymous → set policy to 'readonly'"
    }
  fi

elif [[ "$STORAGE" == "minio" ]] && ! $USE_DOCKER; then
  warn "MinIO not started (--no-docker). Make sure MinIO is running on localhost:9000 with bucket 'sideops'"
fi

# ─── Create .env files ────────────────────────────────────────────────────
header "Configuring .env files"

# --- api-server .env ---
write_env "$ROOT_DIR/api-server/.env" <<ENV
REDIS_URL=$REDIS_URL
PORT=3001
FRONTEND_URL=http://localhost:5173
BASE_DOMAIN=localhost:8080
ENV
ok "api-server/.env  written"

# --- build-server .env ---
if [[ "$STORAGE" == "minio" ]]; then
  write_env "$ROOT_DIR/build-server/.env" <<ENV
REDIS_URL=$REDIS_URL
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=sideops
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
WORKER_CONCURRENCY=2
ENV
elif [[ "$STORAGE" == "aws" ]]; then
  # Use provided values, env vars, or placeholders
  ak="${AWS_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}"
  sk="${AWS_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
  bk="${AWS_BUCKET:-${S3_BUCKET:-}}"
  write_env "$ROOT_DIR/build-server/.env" <<ENV
REDIS_URL=$REDIS_URL
AWS_REGION=$AWS_REGION
AWS_ACCESS_KEY_ID=$ak
AWS_SECRET_ACCESS_KEY=$sk
S3_BUCKET=$bk
S3_ENDPOINT=
S3_FORCE_PATH_STYLE=false
WORKER_CONCURRENCY=2
ENV
fi
ok "build-server/.env written"

# --- s3-reverse-proxy .env ---
if [[ "$STORAGE" == "minio" ]]; then
  S3_BASE_URL="http://localhost:9000/sideops"
else
  # For AWS, try to construct the URL from the bucket/region, or use placeholder
  bk="${AWS_BUCKET:-${S3_BUCKET:-<your-bucket>}}"
  S3_BASE_URL="https://${bk}.s3.${AWS_REGION}.amazonaws.com"
fi
write_env "$ROOT_DIR/s3-reverse-proxy/.env" <<ENV
S3_BASE_URL=$S3_BASE_URL
PORT=8080
ENV
ok "s3-reverse-proxy/.env written"

# --- frontend .env ---
write_env "$ROOT_DIR/frontend/.env" <<ENV
VITE_API_URL=http://localhost:3001
VITE_BASE_DOMAIN=localhost:8080
ENV
ok "frontend/.env  written"

# ─── Install dependencies ─────────────────────────────────────────────────
header "Installing dependencies"
ensure_deps "$ROOT_DIR/api-server"       "api-server"       || true
ensure_deps "$ROOT_DIR/build-server"     "build-server"     || true
ensure_deps "$ROOT_DIR/s3-reverse-proxy" "s3-reverse-proxy" || true
ensure_deps "$ROOT_DIR/frontend"         "frontend"         || true

# ─── Start services ───────────────────────────────────────────────────────
header "Starting services"

# Clear old PID file
: > "$PID_FILE"

start_service() {
  local dir="$1"
  local label="$2"
  local cmd="$3"
  local log_file="$LOGS_DIR/${label}.log"
  info "Starting $label ..."
  # Run in a subshell so cd doesn't affect the main script
  (
    cd "$ROOT_DIR/$dir"
    eval "$cmd"
  ) > "$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >> "$PID_FILE"
  # Give it a moment to fail fast (port conflict, etc.)
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    ok "$label started  (PID $pid, logs: .quick-test-logs/${label}.log)"
  else
    fail "$label failed to start — check .quick-test-logs/${label}.log"
    tail -5 "$log_file" | sed 's/^/    /'
    return 1
  fi
}

start_service "api-server"       "api-server"       "node --watch src/index.js" || true
start_service "build-server"     "build-server"     "node --watch src/index.js" || true
start_service "s3-reverse-proxy" "s3-reverse-proxy" "node --watch index.js"     || true
start_service "frontend"         "frontend"         "npx vite --host 0.0.0.0"   || true

# Give services a moment to bind
sleep 2

# ─── Verify ports ──────────────────────────────────────────────────────────
header "Verifying services"
verify_port() {
  local port="$1" name="$2"
  if wait_for_port "localhost" "$port" "$name" 10; then
    ok "$name  → http://localhost:$port"
  else
    warn "$name may not be ready on port $port — check logs"
  fi
}
verify_port 3001 "api-server"
verify_port 8080 "s3-reverse-proxy"
verify_port 5173 "frontend"

# ─── Summary ───────────────────────────────────────────────────────────────
header "🚀 Everything is running!"

echo -e "  ${CYAN}Storage:${NC}     $STORAGE"
echo -e "  ${CYAN}Redis:${NC}       $REDIS_URL"
echo ""
echo -e "  ${BOLD}Service              URL${NC}"
echo -e "  ───────────────────────────────────────────"
echo -e "  ${GREEN}Frontend${NC}           http://localhost:5173"
echo -e "  ${GREEN}API Server${NC}         http://localhost:3001"
echo -e "  ${GREEN}S3 Reverse Proxy${NC}   http://localhost:8080"
if [[ "$STORAGE" == "minio" ]]; then
  echo -e "  ${GREEN}MinIO Console${NC}      http://localhost:9001  (minioadmin/minioadmin)"
fi
echo ""
echo -e "  ${BOLD}Usage:${NC}"
echo -e "  1. Open http://localhost:5173"
echo -e "  2. Paste a GitHub repo URL (e.g. https://github.com/user/repo)"
echo -e "  3. After build, visit the deployment URL shown in the UI"
echo ""
echo -e "  ${YELLOW}Logs:${NC} ./${LOGS_DIR##*/}/"
echo -e "  ${YELLOW}Stop:${NC}  Press Ctrl+C to stop all services"
echo ""
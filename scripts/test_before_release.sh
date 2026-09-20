#!/usr/bin/env bash
#
# Local pre-release check.
#
# Runs the mandatory gates and then a real proxy canary: for each configured
# country it starts a managed-proxy profile, requires a green verification,
# proves the egress IP is the proxy (never the host), and repeats N times.
#
# It fails closed: any failed start, failed verification, direct egress, or
# country mismatch makes the script exit non-zero.
#
# Usage:
#   scripts/test_before_release.sh
#   COUNTRIES="US DE GB" RUNS=3 scripts/test_before_release.sh
#   SKIP_GATES=1 COUNTRIES="US" RUNS=1 scripts/test_before_release.sh   # canary only
#   KEEP_PROFILES=1 scripts/test_before_release.sh                      # keep canary profiles
#
# Configuration (environment variables):
#   COUNTRIES        space-separated ISO-3166 alpha-2 codes   (default: US DE GB)
#   RUNS             successful verifies per country          (default: 3)
#   RUNTIME          browser runtime                          (default: clawbrowser)
#   IPINFO_URL       JSON endpoint used for the egress check  (default: https://ipinfo.io/json)
#   HOST_IP          override the detected host IP
#   NEXTCTL_BIN      explicit nextctl/nbc binary
#   SKIP_GATES       1 = skip npm gates, run the canary only
#   KEEP_PROFILES    1 = do not remove the canary profiles
#   STOP_ON_FIRST_ERROR 1 = abort after the first failure
#   PROFILE_PREFIX   canary profile name prefix               (default: release-canary)
#
set -uo pipefail

# Use `-` (not `:-`) so an explicitly empty COUNTRIES means "skip the canary".
COUNTRIES="${COUNTRIES-US DE GB}"
RUNS="${RUNS:-3}"
RUNTIME="${RUNTIME:-clawbrowser}"
IPINFO_URL="${IPINFO_URL:-https://ipinfo.io/json}"
SKIP_GATES="${SKIP_GATES:-0}"
KEEP_PROFILES="${KEEP_PROFILES:-0}"
STOP_ON_FIRST_ERROR="${STOP_ON_FIRST_ERROR:-0}"
PROFILE_PREFIX="${PROFILE_PREFIX:-release-canary}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Mirror the runtime locations the desktop app uses so the CLI can authenticate
# and share the managed runtime. Override any of these to match your setup.
export NEXTBROWSER_CONFIG_DIR="${NEXTBROWSER_CONFIG_DIR:-$HOME/.nextbrowser/runtime/config}"
export CLAWBROWSER_CACHE_DIR="${CLAWBROWSER_CACHE_DIR:-$HOME/.nextbrowser/runtime/cache}"
export CLAWBROWSER_DATA_DIR="${CLAWBROWSER_DATA_DIR:-$HOME/.nextbrowser/runtime/data}"
export CLAWBROWSER_STATE_ROOT="${CLAWBROWSER_STATE_ROOT:-$HOME/.nextbrowser/runtime/state}"
export CLAWBROWSER_SESSION_ROOT="${CLAWBROWSER_SESSION_ROOT:-$HOME/.nextbrowser/runtime/sessions}"
export NBC_PROFILE_ROOT="${NBC_PROFILE_ROOT:-$HOME/.nextbrowser/runtime/profiles}"
export CLAWBROWSER_API_BASE_URL="${CLAWBROWSER_API_BASE_URL:-https://api.nextbrowser.com}"

C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_DIM=""
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'
fi

PASS=0
FAIL=0
CREATED_PROFILES=()

log()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); printf '%s\n' "${C_GREEN}PASS${C_RESET} $*"; }
bad()  { FAIL=$((FAIL + 1)); printf '%s\n' "${C_RED}FAIL${C_RESET} $*"; }
warn() { printf '%s\n' "${C_YELLOW}WARN${C_RESET} $*"; }
dim()  { printf '%s\n' "${C_DIM}$*${C_RESET}"; }

need() { command -v "$1" >/dev/null 2>&1 || { printf '%s\n' "${C_RED}Missing required command: $1${C_RESET}" >&2; exit 2; }; }

resolve_nextctl() {
  local candidates=()
  [ -n "${NEXTCTL_BIN:-}" ] && candidates+=("$NEXTCTL_BIN")
  candidates+=(
    "$HOME/.nextbrowser/managed-nextctl/nextctl"
    "$ROOT/../nextctl/bin/nextctl"
    "$ROOT/../nextctl/bin/nbc"
  )
  local c
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  command -v nextctl 2>/dev/null || command -v nbc 2>/dev/null || return 1
}

cleanup() {
  [ "$KEEP_PROFILES" = "1" ] && { warn "KEEP_PROFILES=1: leaving ${#CREATED_PROFILES[@]} canary profile(s) in place"; return; }
  local p
  for p in "${CREATED_PROFILES[@]:-}"; do
    [ -n "$p" ] || continue
    "$NCTL" stop --profile "$p" --runtime "$RUNTIME" --format json >/dev/null 2>&1 || true
    "$NCTL" profiles rm "$p" --format json >/dev/null 2>&1 || true
  done
}

json_field() {
  # json_field <json> <python-expression-on-d> -> prints result or empty
  python3 -c '
import sys, json
raw = sys.argv[1]
expr = sys.argv[2]
try:
    d = json.loads(raw)
except Exception:
    print(""); sys.exit(0)
try:
    v = eval(expr, {"__builtins__": {}}, {"d": d})
    print("" if v is None else v)
except Exception:
    print("")
' "$1" "$2"
}

nextctl_error() {
  # Human message from a nextctl JSON error envelope, else the last output line.
  local raw="$1" msg hint
  msg="$(json_field "$raw" 'd.get("error",{}).get("message","")')"
  hint="$(json_field "$raw" 'd.get("error",{}).get("hint","")')"
  if [ -n "$msg" ]; then
    if [ -n "$hint" ]; then printf '%s — %s\n' "$msg" "$hint"; else printf '%s\n' "$msg"; fi
    return
  fi
  printf '%s\n' "$(printf '%s' "$raw" | tail -n1)"
}

host_ip() {
  if [ -n "${HOST_IP:-}" ]; then printf '%s\n' "$HOST_IP"; return; fi
  curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true
}

run_gates() {
  log ""
  log "== Mandatory gates =="
  ( cd "$ROOT" && npm run test:critical ) && ok "test:critical" || bad "test:critical"
  ( cd "$ROOT" && npm test )             && ok "npm test"      || bad "npm test"
  ( cd "$ROOT" && npm run build )        && ok "npm run build" || bad "npm run build"
}

canary_one() {
  local country="$1" run="$2"
  local name="${PROFILE_PREFIX}-$(printf '%s' "$country" | tr '[:upper:]' '[:lower:]')-${run}"
  local label="$country run $run ($name)"

  # Start clean if a previous attempt left the profile behind.
  "$NCTL" stop --profile "$name" --runtime "$RUNTIME" --format json >/dev/null 2>&1 || true
  "$NCTL" profiles rm "$name" --format json >/dev/null 2>&1 || true

  local out
  out="$("$NCTL" profiles create "$name" --country "$country" --runtime "$RUNTIME" --format json 2>&1)" || {
    bad "$label: profile create failed: $(nextctl_error "$out")"; return 1; }
  CREATED_PROFILES+=("$name")

  # Start with mandatory verification and open the egress JSON endpoint.
  out="$("$NCTL" start --profile "$name" --runtime "$RUNTIME" --verify --url "$IPINFO_URL" --format json 2>&1)" || {
    bad "$label: start/verify failed: $(nextctl_error "$out")"
    "$NCTL" stop --profile "$name" --runtime "$RUNTIME" --format json >/dev/null 2>&1 || true
    return 1; }

  # Explicit verification must be green.
  local vout vstatus
  vout="$("$NCTL" verify --profile "$name" --runtime "$RUNTIME" --timeout 30s --format json 2>&1)" || true
  vstatus="$(json_field "$vout" 'd.get("data",{}).get("verify",{}).get("status","")')"
  if [ "$vstatus" != "pass" ]; then
    bad "$label: verification not green (status='${vstatus:-none}')"
    "$NCTL" stop --profile "$name" --runtime "$RUNTIME" --format json >/dev/null 2>&1 || true
    return 1
  fi

  # Read the egress identity from the page.
  local eout page eip ecountry
  eout="$("$NCTL" eval "document.body.innerText" --profile "$name" --runtime "$RUNTIME" --format json 2>&1)" || true
  page="$(json_field "$eout" 'd.get("data","")')"
  eip="$(json_field "$page" 'd.get("ip","")')"
  ecountry="$(json_field "$page" 'd.get("country","")')"

  local host; host="$(host_ip)"
  local okrun=1
  if [ -z "$eip" ]; then
    bad "$label: could not read egress IP"; okrun=0
  elif [ -n "$host" ] && [ "$eip" = "$host" ]; then
    bad "$label: DIRECT egress detected (egress=$eip = host)"; okrun=0
  fi
  if [ -n "$ecountry" ] && [ "$(printf '%s' "$ecountry" | tr '[:lower:]' '[:upper:]')" != "$country" ]; then
    bad "$label: country mismatch (egress=${ecountry}, expected=${country})"; okrun=0
  fi

  "$NCTL" stop --profile "$name" --runtime "$RUNTIME" --format json >/dev/null 2>&1 || true

  if [ "$okrun" = "1" ]; then
    ok "$label: verify=pass egress=$eip country=${ecountry:-?} (host=$host)"
    return 0
  fi
  return 1
}

run_canary() {
  log ""
  log "== Proxy canary: $RUNS successful verifies x countries [$COUNTRIES] =="
  local host; host="$(host_ip)"
  [ -n "$host" ] && dim "host IP: $host" || warn "could not detect host IP; direct-egress check relies on country only"
  dim "nextctl: $NCTL ($("$NCTL" --version 2>/dev/null | head -n1 || echo version unknown))"

  local cc run
  for cc in $COUNTRIES; do
    for run in $(seq 1 "$RUNS"); do
      canary_one "$cc" "$run" || {
        if [ "$STOP_ON_FIRST_ERROR" = "1" ]; then
          warn "STOP_ON_FIRST_ERROR=1: aborting canary"
          return
        fi
      }
    done
  done
}

main() {
  need python3
  need curl

  if ! NCTL="$(resolve_nextctl)"; then
    printf '%s\n' "${C_RED}No nextctl binary found. Set NEXTCTL_BIN.${C_RESET}" >&2
    exit 2
  fi
  export NCTL

  trap cleanup EXIT

  log "NextBrowser pre-release check"
  dim "root: $ROOT"
  dim "countries: $COUNTRIES | runs/country: $RUNS | runtime: $RUNTIME"

  [ "$SKIP_GATES" = "1" ] || run_gates
  run_canary

  log ""
  log "== Summary =="
  printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
  if [ "$FAIL" -gt 0 ]; then
    printf '%s\n' "${C_RED}Pre-release check FAILED${C_RESET}"
    exit 1
  fi
  printf '%s\n' "${C_GREEN}Pre-release check PASSED${C_RESET}"
}

main "$@"

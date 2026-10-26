#!/usr/bin/env bash
# Signs and notarizes a macOS NextBrowser.app with a Developer ID key that lives
# on another machine, using rcodesign remote signing (same flow as clawbrowser's
# scripts/sign_macos_remote.sh):
#
#   this machine (initiator)                      signer (over SSH)
#   rcodesign sign --remote-signer ...  --sjs-->  rcodesign remote-sign <sjs>
#   (has the app, never the key)                  (has the .p12, never the app)
#
# Input is the ad-hoc signed zip from `npm run dist:mac` (or a CI artifact).
# Output is a signed, notarized and stapled zip; with --latest-yml the updater
# manifest is rewritten to the new zip's sha512/size so electron-updater accepts it.
#
# Run on macOS or Linux. Not on Windows: extracting the bundle onto NTFS loses
# the framework's Versions/Current symlinks and exec bits and breaks the app.
set -euo pipefail

RCODESIGN="${RCODESIGN:-rcodesign}"
REMOTE_RCODESIGN="${REMOTE_RCODESIGN:-rcodesign}"
SJS_TIMEOUT_SECONDS="${SJS_TIMEOUT_SECONDS:-60}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INPUT=""
OUTPUT=""
SIGNER=""
SIGNER_P12=""
SIGNER_P12_PASSWORD_FILE=""
CERT_PEM=""
ENTITLEMENTS="${SCRIPT_DIR}/../build/entitlements.mac.plist"
API_KEY_FILE=""
LATEST_YML=""
NOTARIZE=1
SSH_OPTS=()
WORK_DIR=""
SIGN_SETTINGS=()

log() {
  printf '[sign-macos-remote] %s\n' "$*"
}

die() {
  printf '[sign-macos-remote] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/sign_macos_remote.sh --input <NextBrowser.app|NextBrowser-<ver>-arm64.zip>
      --signer <user@host> --signer-p12 <remote .p12> --signer-p12-password-file <remote file>
      (--api-key-file <App Store Connect key .json> | --no-notarize)
      [--output <signed .zip>] [--latest-yml <release/latest-mac.yml>]
      [--entitlements <plist>] [--cert-pem <Developer ID cert .pem>] [--ssh-opt <opt>]...

Options:
  --input                     Unsigned (or ad-hoc signed) NextBrowser.app, or the
                              mac zip produced by `npm run dist:mac`.
  --output                    Signed zip to write. Default: overwrite a zip input,
                              or <dir>/NextBrowser-signed.zip for an .app input.
  --latest-yml                electron-updater manifest to update with the signed
                              zip's sha512 and size (the stale .blockmap is removed).
  --signer                    SSH destination of the machine holding the key.
  --signer-p12                Path of the Developer ID Application .p12 on the signer.
  --signer-p12-password-file  Path of a file with the .p12 password on the signer.
  --entitlements              Entitlements for the app and every nested binary.
                              Default: build/entitlements.mac.plist.
  --cert-pem                  Local PEM of the Developer ID certificate (public part).
                              Default: extracted from the signer's .p12 with openssl.
  --api-key-file              App Store Connect API key JSON, created with
                              `rcodesign encode-app-store-connect-api-key`.
  --no-notarize               Sign only; skip notarization and stapling.
  --ssh-opt                   Extra ssh option, repeatable (e.g. --ssh-opt -i --ssh-opt ~/.ssh/key).

Environment:
  RCODESIGN, REMOTE_RCODESIGN  rcodesign binary locally / on the signer.
  SJS_TIMEOUT_SECONDS          How long to wait for the session join string.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --input) INPUT="$2"; shift 2 ;;
      --output) OUTPUT="$2"; shift 2 ;;
      --latest-yml) LATEST_YML="$2"; shift 2 ;;
      --signer) SIGNER="$2"; shift 2 ;;
      --signer-p12) SIGNER_P12="$2"; shift 2 ;;
      --signer-p12-password-file) SIGNER_P12_PASSWORD_FILE="$2"; shift 2 ;;
      --cert-pem) CERT_PEM="$2"; shift 2 ;;
      --entitlements) ENTITLEMENTS="$2"; shift 2 ;;
      --api-key-file) API_KEY_FILE="$2"; shift 2 ;;
      --no-notarize) NOTARIZE=0; shift ;;
      --ssh-opt) SSH_OPTS+=("$2"); shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${INPUT}" ]] || die "--input is required"
  [[ -n "${SIGNER}" ]] || die "--signer is required"
  [[ -n "${SIGNER_P12}" ]] || die "--signer-p12 is required"
  [[ -n "${SIGNER_P12_PASSWORD_FILE}" ]] || die "--signer-p12-password-file is required"
  [[ -f "${ENTITLEMENTS}" ]] || die "entitlements not found: ${ENTITLEMENTS}"
  if [[ -n "${LATEST_YML}" ]]; then
    [[ -f "${LATEST_YML}" ]] || die "latest yml not found: ${LATEST_YML}"
  fi
  if [[ "${NOTARIZE}" == "1" ]]; then
    [[ -n "${API_KEY_FILE}" ]] || die "--api-key-file is required (or pass --no-notarize)"
    [[ -f "${API_KEY_FILE}" ]] || die "API key file not found: ${API_KEY_FILE}"
  fi
}

# Runs a command on the signer; each argument is quoted for the remote shell.
remote() {
  local quoted=""
  printf -v quoted '%q ' "$@"
  # ${arr[@]+...}: empty arrays are "unbound" under set -u in macOS bash 3.2.
  ssh ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} -- "${SIGNER}" "${quoted}"
}

preflight() {
  case "$(uname -s)" in
    Darwin|Linux) ;;
    *) die "run this on macOS or Linux (see header comment), not $(uname -s)" ;;
  esac
  command -v "${RCODESIGN}" >/dev/null || die "rcodesign not found locally: ${RCODESIGN}"
  command -v unzip >/dev/null || die "unzip not found"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    command -v zip >/dev/null || die "zip not found"
  fi

  log "checking signer ${SIGNER}"
  remote "${REMOTE_RCODESIGN}" --version >/dev/null || \
    die "rcodesign not runnable on signer: ${REMOTE_RCODESIGN}"
  remote test -f "${SIGNER_P12}" || die "signer .p12 not found: ${SIGNER_P12}"
  remote test -f "${SIGNER_P12_PASSWORD_FILE}" || \
    die "signer password file not found: ${SIGNER_P12_PASSWORD_FILE}"
}

# Writes the public Developer ID certificate to $1. The private key stays on
# the signer; only the certificate crosses the wire.
fetch_cert_pem() {
  local dest="$1"

  if [[ -n "${CERT_PEM}" ]]; then
    cp "${CERT_PEM}" "${dest}"
  else
    log "extracting certificate from signer .p12"
    remote sh -c 'openssl pkcs12 -in "$1" -nokeys -clcerts -passin "file:$2" | openssl x509' \
      _ "${SIGNER_P12}" "${SIGNER_P12_PASSWORD_FILE}" >"${dest}" || \
      die "could not extract the certificate; export it and pass --cert-pem"
  fi
  grep -q 'BEGIN CERTIFICATE' "${dest}" || die "no certificate in ${dest}"
}

# Prints Mach-O paths under the app root, relative to it (detected by magic).
macho_executables() {
  local app="$1" file magic

  (cd "${app}" && find . -type f -print) | sed 's|^\./||' | while IFS= read -r file; do
    magic="$(od -An -tx1 -N4 "${app}/${file}" | tr -d ' \n')"
    case "${magic}" in
      cffaedfe|cefaedfe|feedfacf|feedface|cafebabe) printf '%s\n' "${file}" ;;
    esac
  done
}

# Builds rcodesign settings matching electron-builder's mac config: hardened
# runtime everywhere and build/entitlements.mac.plist as both `entitlements`
# and `entitlementsInherit`. rcodesign does not inherit entitlements or code
# signature flags into nested code, so each nested bundle (Electron helpers,
# login items) and loose Mach-O (node-pty spawn-helper, .node addons, dylibs)
# gets a path-scoped setting. Fills SIGN_SETTINGS (macOS ships bash 3.2).
build_sign_settings() {
  local app="$1"
  local bundle file

  SIGN_SETTINGS=(
    --code-signature-flags runtime
    --entitlements-xml-path entitlements.plist
  )

  while IFS= read -r bundle; do
    SIGN_SETTINGS+=(
      --code-signature-flags "${bundle}:runtime"
      --entitlements-xml-path "${bundle}:entitlements.plist"
    )
  done < <(cd "${app}" && find . -mindepth 2 -type d -name '*.app' -print | sed 's|^\./||')

  # Bundle main executables under Contents/MacOS take their bundle's settings.
  while IFS= read -r file; do
    case "${file}" in
      Contents/MacOS/*|*/Contents/MacOS/*) ;;
      *) SIGN_SETTINGS+=(
           --code-signature-flags "${file}:runtime"
           --entitlements-xml-path "${file}:entitlements.plist"
         ) ;;
    esac
  done < <(macho_executables "${app}")
}

# Starts the initiator, waits for its one-time session join string, and has
# the signer join the session over SSH.
remote_sign() {
  local log_file="$1"
  shift
  local pid sjs="" waited=0

  "${RCODESIGN}" sign --remote-signer --remote-public-key-pem-file cert.pem "$@" \
    >"${log_file}" 2>&1 &
  pid=$!

  while [[ -z "${sjs}" ]]; do
    sjs="$(sed -n 's/^[[:space:]]*rcodesign remote-sign \([^[:space:]]*\).*$/\1/p' "${log_file}" | head -n1)"
    [[ -n "${sjs}" ]] && break
    if ! kill -0 "${pid}" 2>/dev/null; then
      cat "${log_file}" >&2
      die "rcodesign exited before printing a session join string"
    fi
    if (( waited >= SJS_TIMEOUT_SECONDS * 2 )); then
      kill "${pid}" 2>/dev/null || true
      cat "${log_file}" >&2
      die "timed out waiting for the session join string"
    fi
    sleep 0.5
    waited=$((waited + 1))
  done

  log "session created; signer ${SIGNER} is joining"
  if ! remote "${REMOTE_RCODESIGN}" remote-sign \
      --p12-file "${SIGNER_P12}" \
      --p12-password-file "${SIGNER_P12_PASSWORD_FILE}" \
      "${sjs}"; then
    kill "${pid}" 2>/dev/null || true
    cat "${log_file}" >&2
    die "signer failed to sign"
  fi

  if ! wait "${pid}"; then
    cat "${log_file}" >&2
    die "rcodesign sign failed"
  fi
}

# Fails if the path-scoped settings did not land (e.g. rcodesign resolved the
# framework through Versions/Current instead of the real Versions/<n> path).
verify_signature() {
  local app="$1" helper exe info

  info="$("${RCODESIGN}" print-signature-info "${app}/Contents/MacOS/"*)"
  grep -qi 'runtime' <<<"${info}" || die "outer app executable lacks hardened runtime"
  grep -q 'com.apple.security.cs.allow-jit' <<<"${info}" || \
    die "outer app executable lacks the allow-jit entitlement"

  helper="$(find "${app}" -type d -name '* Helper (Renderer).app' -print -quit)"
  [[ -n "${helper}" ]] || die "renderer helper not found in ${app}"
  exe="$(find "${helper}/Contents/MacOS" -type f -print -quit)"
  info="$("${RCODESIGN}" print-signature-info "${exe}")"
  grep -qi 'runtime' <<<"${info}" || die "renderer helper lacks hardened runtime"
  grep -q 'com.apple.security.cs.allow-jit' <<<"${info}" || \
    die "renderer helper lacks the allow-jit entitlement"

  if [[ "$(uname -s)" == "Darwin" ]]; then
    codesign --verify --deep --strict --verbose=2 "${app}"
  fi
}

# Zips the app keeping symlinks and exec bits, like electron-builder's mac zip.
pack_zip() {
  local app_dir="$1" app_name="$2" dest="$3"

  rm -f "${dest}"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    ditto -c -k --sequesterRsrc --keepParent "${app_dir}/${app_name}" "${dest}"
  else
    (cd "${app_dir}" && zip -qry --symlinks "${dest}" "${app_name}")
  fi
}

# Points the zip entry of latest-mac.yml at the signed zip. electron-updater
# verifies the download against this sha512, so a stale manifest breaks updates.
update_latest_yml() {
  local zip="$1" yml="$2" name sha size

  name="$(basename "${zip}")"
  grep -q "url: ${name}\$" "${yml}" || die "${yml} has no entry for ${name}"
  sha="$(openssl dgst -sha512 -binary "${zip}" | openssl base64 -A)"
  size="$(wc -c <"${zip}" | tr -d ' ')"
  # The zip is the top-level path/sha512 in electron-builder's mac manifest.
  awk -v name="${name}" -v sha="${sha}" -v size="${size}" '
    $0 ~ "url: " name "$" { hit = 1; print; next }
    hit && /sha512:/ { sub(/sha512: .*/, "sha512: " sha); print; next }
    hit && /size:/ { sub(/size: .*/, "size: " size); print; hit = 0; next }
    /^path: / && $2 == name { top = 1 }
    top && /^sha512: / { print "sha512: " sha; top = 0; next }
    { print }
  ' "${yml}" >"${yml}.tmp"
  mv "${yml}.tmp" "${yml}"
  rm -f "${zip}.blockmap"
  log "updated ${yml}"
}

main() {
  parse_args "$@"
  preflight

  local work app_name src_app
  WORK_DIR="$(mktemp -d)"
  work="${WORK_DIR}"
  trap 'rm -rf "${WORK_DIR}"' EXIT

  mkdir -p "${work}/in" "${work}/out"
  case "${INPUT}" in
    *.zip)
      unzip -q "${INPUT}" -d "${work}/in"
      src_app="$(find "${work}/in" -mindepth 1 -maxdepth 1 -type d -name '*.app' -print -quit)"
      [[ -n "${src_app}" ]] || die "no .app at the top of ${INPUT}"
      : "${OUTPUT:=$(cd "$(dirname "${INPUT}")" && pwd)/$(basename "${INPUT}")}"
      ;;
    *.app|*.app/)
      [[ -d "${INPUT}" ]] || die "not a directory: ${INPUT}"
      src_app="${work}/in/$(basename "${INPUT%/}")"
      cp -a "${INPUT%/}" "${src_app}"
      ;;
    *) die "--input must be a .app or .zip" ;;
  esac
  app_name="$(basename "${src_app}")"
  : "${OUTPUT:=$(cd "$(dirname "${INPUT}")" && pwd)/${app_name%.app}-signed.zip}"

  cp "${ENTITLEMENTS}" "${work}/entitlements.plist"
  fetch_cert_pem "${work}/cert.pem"

  build_sign_settings "${src_app}"

  # Relative paths throughout: rcodesign splits scoped values at the first colon.
  log "signing ${app_name}"
  (
    cd "${work}"
    remote_sign "${work}/sign.log" "${SIGN_SETTINGS[@]}" "in/${app_name}" "out/${app_name}"
  )
  verify_signature "${work}/out/${app_name}"

  if [[ "${NOTARIZE}" == "1" ]]; then
    log "notarizing and stapling (this can take several minutes)"
    "${RCODESIGN}" notary-submit --api-key-file "${API_KEY_FILE}" --staple "${work}/out/${app_name}"
    if [[ "$(uname -s)" == "Darwin" ]]; then
      spctl --assess --type execute --verbose=2 "${work}/out/${app_name}"
    fi
  fi

  pack_zip "${work}/out" "${app_name}" "${OUTPUT}"
  log "wrote ${OUTPUT}"

  if [[ -n "${LATEST_YML}" ]]; then
    update_latest_yml "${OUTPUT}" "${LATEST_YML}"
  fi
}

main "$@"

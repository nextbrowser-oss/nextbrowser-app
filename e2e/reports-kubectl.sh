#!/usr/bin/env bash
# Prints the backend's log since $1 (RFC 3339) for E2E_REPORTS_CMD. Reads the
# production Nextbrowser backend through kubectl; set E2E_BACKEND_NAMESPACE and
# E2E_BACKEND_DEPLOYMENT for another environment.
set -euo pipefail
since=${1:?usage: reports-kubectl.sh <since>}
kubectl logs -n "${E2E_BACKEND_NAMESPACE:-nextbrowser-prod}" "deploy/${E2E_BACKEND_DEPLOYMENT:-nextbrowser-backend}" --since-time="$since"

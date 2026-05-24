#!/usr/bin/env bash
# Deploy the root Google Apps Script project as a Web App.
#
# Usage:
#   ./scripts/deploy-gas-webapp.sh
#   ./scripts/deploy-gas-webapp.sh --description "prod update"
#   ./scripts/deploy-gas-webapp.sh --deployment-id AKfycbx...
#
# Notes:
# - Run from anywhere inside this repository.
# - Uses npx clasp, so a global clasp install is not required.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

description="prod web app"
deployment_id=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --description|-d)
            description="$2"
            shift 2
            ;;
        --deployment-id|-i)
            deployment_id="$2"
            shift 2
            ;;
        --help|-h)
            cat <<'EOF'
Deploy the root Google Apps Script project as a Web App.

Usage:
  ./scripts/deploy-gas-webapp.sh
  ./scripts/deploy-gas-webapp.sh --description "prod update"
  ./scripts/deploy-gas-webapp.sh --deployment-id AKfycbx...

Options:
  -d, --description    Deployment description text.
  -i, --deployment-id  Update an existing deployment instead of creating a new one.
  -h, --help           Show this help message.
EOF
            exit 0
            ;;
        *)
            echo "Unknown flag: $1" >&2
            exit 1
            ;;
    esac
done

if [[ ! -f ".clasp.json" ]] || [[ ! -f "appsscript.json" ]]; then
    echo "Missing .clasp.json or appsscript.json in repo root." >&2
    exit 1
fi

echo "[1/5] Checking clasp availability"
npx --yes @google/clasp --version >/dev/null

echo "[2/5] Checking login status"
if ! npx --yes @google/clasp whoami >/dev/null 2>&1; then
    echo "You are not logged in to clasp. Run:"
    echo "  npx --yes @google/clasp login --no-localhost"
    exit 1
fi

echo "[3/5] Pushing local files to Apps Script"
npx --yes @google/clasp push -f

echo "[4/5] Deploying web app"
if [[ -n "$deployment_id" ]]; then
    npx --yes @google/clasp deploy --deploymentId "$deployment_id" --description "$description"
else
    npx --yes @google/clasp deploy --description "$description"
fi

echo "[5/5] Opening web app and listing deployments"
npx --yes @google/clasp open --webapp || true
npx --yes @google/clasp deployments || true

echo
echo "Done. If a browser did not open, copy the Web App URL from Apps Script Deployments."

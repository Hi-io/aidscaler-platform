#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
context="${KUBE_CONTEXT:-kubernetes-admin@kubernetes}"
# Provision demo-credentials separately. Never print its values or include them
# in source ConfigMaps, images, command-line arguments or frontend responses.
kubectl --context "$context" -n aidscaler get secret demo-credentials -o name >/dev/null
python3 "$project_dir/deploy/render-demo.py" | kubectl --context "$context" apply --server-side --field-manager=aidscaler-demo -f -
kubectl --context "$context" -n aidscaler rollout status deployment/demo-postgres --timeout=300s
kubectl --context "$context" -n aidscaler rollout status deployment/demo --timeout=480s
printf 'Demo runtime ready: http://demo.aidscaler.svc.cluster.local:8080/demo/api/health\n'
printf 'Publish the existing landing proxy only after checking the runtime.\n'

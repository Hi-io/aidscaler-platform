"""Render the local bridge at zero replicas; activation is an explicit cutover."""
import base64, gzip, hashlib, io, json, tarfile
from pathlib import Path

platform = Path(__file__).resolve().parents[2]
workspace = platform.parent
stage = platform / ".local/gcp/stage/simulator"
if not (stage / "scripts/gcp-bridge.mjs").exists():
    raise SystemExit("Run node deploy/gcp/prepare.mjs first.")
label = {"app.kubernetes.io/name": "aidscaler-gcp-simulator"}
namespace = "aidscaler"
bundle = io.BytesIO()
with tarfile.open(fileobj=bundle, mode="w") as archive:
    for file in sorted(stage.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(stage)
        if file.is_symlink() or "node_modules" in relative.parts or any(p.startswith(".") for p in relative.parts):
            raise ValueError("Unexpected private or linked build file")
        data = file.read_bytes()
        item = tarfile.TarInfo(str(relative).replace("\\", "/"))
        item.size, item.mode, item.mtime = len(data), 0o644, 0
        archive.addfile(item, io.BytesIO(data))
payload = gzip.compress(bundle.getvalue(), mtime=0)
revision = hashlib.sha256(payload).hexdigest()[:16]
items, sources = [], []
for index, start in enumerate(range(0, len(payload), 420000)):
    name = f"gcp-simulator-source-{revision}-{index}"
    items.append({"apiVersion": "v1", "kind": "ConfigMap", "immutable": True,
                  "metadata": {"name": name, "namespace": namespace, "labels": label},
                  "binaryData": {f"part-{index:04d}": base64.b64encode(payload[start:start+420000]).decode()}})
    sources.append({"configMap": {"name": name}})
provider = "//iam.googleapis.com/projects/439219992256/locations/global/workloadIdentityPools/aidscaler-local/providers/kubernetes"
credentials = {
    "type": "external_account",
    "audience": provider,
    "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
    "token_url": "https://sts.googleapis.com/v1/token",
    "service_account_impersonation_url": "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/aidscaler-simulator@aidscaler.iam.gserviceaccount.com:generateAccessToken",
    "credential_source": {"file": "/var/run/google/token", "format": {"type": "text"}}
}
items.append({"apiVersion": "v1", "kind": "ServiceAccount",
              "metadata": {"name": "aidscaler-simulator", "namespace": namespace},
              "automountServiceAccountToken": False})
items.append({"apiVersion": "v1", "kind": "ConfigMap", "metadata": {
    "name": "aidscaler-google-federation", "namespace": namespace},
    "data": {"google.json": json.dumps(credentials)}})
image = "node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5"
install = """set -eu
cat /source/part-* | tar -xz -C /app
npm install --prefix /tmp/tools --no-audit --no-fund --ignore-scripts pnpm@11.25.0
cd /app
node /tmp/tools/node_modules/pnpm/bin/pnpm.cjs install --prod --frozen-lockfile --ignore-scripts
"""
environment = {
    "GOOGLE_CLOUD_PROJECT": "aidscaler", "GOOGLE_APPLICATION_CREDENTIALS": "/etc/google/google.json",
    "BRIDGE_COMMAND_SUBSCRIPTION": "aidscaler-simulator-commands", "BRIDGE_REPLY_TOPIC": "aidscaler-replies",
    "DATA_DIR": "/data/demo/gcp-bridge", "DEMO_WORLD_DIR": "/data/demo/simulator",
    "DEMO_ALLOW_BUILD_UPGRADE": "true", "DEMO_RATE": "10", "HOME": "/tmp", "PORT": "8081"
}
items.append({"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {
    "name": "gcp-simulator", "namespace": namespace, "labels": label}, "spec": {
    "replicas": 0, "strategy": {"type": "Recreate"}, "selector": {"matchLabels": label},
    "template": {"metadata": {"labels": label}, "spec": {
        "serviceAccountName": "aidscaler-simulator", "automountServiceAccountToken": False,
        "nodeSelector": {"kubernetes.io/hostname": "worker-1"},
        "terminationGracePeriodSeconds": 120,
        "securityContext": {"runAsUser": 1000, "runAsGroup": 1000, "fsGroup": 1000},
        "initContainers": [{"name": "install-release", "image": image, "workingDir": "/app",
            "command": ["sh", "-c", install],
            "resources": {"requests": {"cpu": "100m", "memory": "192Mi"}, "limits": {"cpu": "1", "memory": "512Mi"}},
            "volumeMounts": [{"name": "source", "mountPath": "/source", "readOnly": True},
                             {"name": "app", "mountPath": "/app"}, {"name": "tmp", "mountPath": "/tmp"}]}],
        "containers": [{"name": "simulator", "image": image, "workingDir": "/app",
            "command": ["node", "scripts/gcp-bridge.mjs"],
            "env": [{"name": key, "value": value} for key, value in environment.items()],
            "resources": {"requests": {"cpu": "500m", "memory": "1Gi"}, "limits": {"cpu": "2", "memory": "2Gi"}},
            "ports": [{"containerPort": 8081}],
            "startupProbe": {"httpGet": {"path": "/healthz", "port": 8081}, "periodSeconds": 5, "failureThreshold": 36},
            "readinessProbe": {"httpGet": {"path": "/healthz", "port": 8081}, "periodSeconds": 10},
            "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                                "capabilities": {"drop": ["ALL"]}},
            "volumeMounts": [{"name": "app", "mountPath": "/app", "readOnly": True},
                {"name": "data", "mountPath": "/data"}, {"name": "tmp", "mountPath": "/tmp"},
                {"name": "token", "mountPath": "/var/run/google", "readOnly": True},
                {"name": "federation", "mountPath": "/etc/google", "readOnly": True}]}],
        "volumes": [{"name": "app", "emptyDir": {}}, {"name": "tmp", "emptyDir": {}},
            {"name": "data", "persistentVolumeClaim": {"claimName": "demo-data"}},
            {"name": "source", "projected": {"sources": sources}},
            {"name": "federation", "configMap": {"name": "aidscaler-google-federation"}},
            {"name": "token", "projected": {"sources": [{"serviceAccountToken": {
                "path": "token", "expirationSeconds": 3600, "audience": "https:" + provider}}]}}]
    }}}})
items.append({"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy",
    "metadata": {"name": "gcp-simulator-private", "namespace": namespace}, "spec": {
        "podSelector": {"matchLabels": label}, "policyTypes": ["Ingress", "Egress"], "ingress": [],
        "egress": [{"ports": [{"protocol": "TCP", "port": 443}]},
                   {"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}]}]}})
print(json.dumps({"apiVersion": "v1", "kind": "List", "items": items}))

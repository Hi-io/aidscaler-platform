"""Render an immutable, secret-free AidScaler demo release for the existing cluster.

The application bundle is code only. Databases/checkpoints use retained volumes;
provider/database/session credentials belong in the separately provisioned Secret.
"""
import base64
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import re
import tarfile

PLATFORM = Path(__file__).resolve().parent.parent
WORKSPACE = PLATFORM.parent
NAMESPACE = "aidscaler"
NODE = os.environ.get("DEMO_NODE_IMAGE", "node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5")
POSTGRES = os.environ.get("DEMO_POSTGRES_IMAGE", "postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826")
PERMISSIONS = "busybox@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e"
NODE_NAME = os.environ.get("DEMO_NODE_NAME", "worker-1")
LABEL = {"app.kubernetes.io/name": "aidscaler-demo"}
DB_LABEL = {"app.kubernetes.io/name": "aidscaler-demo-postgres"}
SECRET_NAME = "demo-credentials"
MAX_PART = 420_000

directories = {
    "nexo-platform": ["src", "ui", "scripts"],
    "disaster-response-simulator": ["adapters", "content", "contracts", "engine", "evaluation", "generators", "manifests", "policies", "scenarios", "scripts", "sources", "viewer"],
    "nexo-vision": ["dist/demo"],
}
root_files = {
    "nexo-platform": ["server.mjs", "package.json", "pnpm-lock.yaml"],
    "disaster-response-simulator": ["package.json", "pnpm-lock.yaml", "cli.mjs", "service.mjs", "lab.mjs"],
    "nexo-vision": [],
}
secret_pattern = re.compile(rb"sk-or-v1-[a-z0-9]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.I)
bundle = io.BytesIO()
with tarfile.open(fileobj=bundle, mode="w") as tar:
    for project, folders in directories.items():
        project_root = WORKSPACE / project
        files = {project_root / name for name in root_files[project] if (project_root / name).is_file()}
        for folder in folders:
            if (project_root / folder).is_dir():
                files.update(p for p in (project_root / folder).rglob("*") if p.is_file())
        for file in sorted(files):
            relative = file.relative_to(project_root)
            if file.is_symlink() or any(part.startswith(".") or part == "node_modules" for part in relative.parts):
                raise ValueError(f"Private or linked artifact cannot be bundled: {relative}")
            payload = file.read_bytes()
            if secret_pattern.search(payload):
                raise ValueError(f"Credential pattern in release source: {project}/{relative}")
            entry = tarfile.TarInfo(f"{project}/{relative.as_posix()}")
            entry.size, entry.mode, entry.mtime = len(payload), 0o644, 0
            tar.addfile(entry, io.BytesIO(payload))
payload = gzip.compress(bundle.getvalue(), compresslevel=6, mtime=0)
revision = hashlib.sha256(payload).hexdigest()[:16]
items, volumes = [], []
for i, start in enumerate(range(0, len(payload), MAX_PART)):
    name = f"demo-source-{revision}-{i}"
    key = f"part-{i:04d}"
    items.append({"apiVersion": "v1", "kind": "ConfigMap", "immutable": True,
                  "metadata": {"name": name, "namespace": NAMESPACE, "labels": LABEL},
                  "binaryData": {key: base64.b64encode(payload[start:start + MAX_PART]).decode()}})
    volumes.append({"configMap": {"name": name}})

def resource(kind, name, spec, labels=None, namespace=True):
    metadata = {"name": name, "labels": labels or LABEL}
    if namespace:
        metadata["namespace"] = NAMESPACE
    return {"apiVersion": "apps/v1" if kind == "Deployment" else "networking.k8s.io/v1" if kind == "NetworkPolicy" else "v1",
            "kind": kind, "metadata": metadata, "spec": spec}

for name, size, directory in [("demo-data", "12Gi", "runtime"), ("demo-postgres", "8Gi", "postgres")]:
    items.append(resource("PersistentVolume", f"aidscaler-{name}", {
        "capacity": {"storage": size}, "accessModes": ["ReadWriteOnce"], "storageClassName": "",
        "persistentVolumeReclaimPolicy": "Retain", "volumeMode": "Filesystem",
        "hostPath": {"path": f"/var/lib/aidscaler-demo/{directory}", "type": "DirectoryOrCreate"},
        "nodeAffinity": {"required": {"nodeSelectorTerms": [{"matchExpressions": [{"key": "kubernetes.io/hostname", "operator": "In", "values": [NODE_NAME]}]}]}}
    }, namespace=False))
    items.append(resource("PersistentVolumeClaim", name, {"accessModes": ["ReadWriteOnce"], "storageClassName": "",
        "volumeName": f"aidscaler-{name}", "resources": {"requests": {"storage": size}}}))

security = {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}}
def permissions(volume, user):
    return {"name": "volume-permissions", "image": PERMISSIONS,
            "command": ["sh", "-c", f"chown {user}:{user} /volume && chmod 700 /volume"],
            "securityContext": {"runAsUser": 0, "allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"], "add": ["CHOWN", "FOWNER"]}},
            "resources": {"requests": {"cpu": "5m", "memory": "8Mi"}, "limits": {"cpu": "100m", "memory": "32Mi"}},
            "volumeMounts": [{"name": volume, "mountPath": "/volume"}]}

items.append(resource("Service", "demo-postgres", {"selector": DB_LABEL, "ports": [{"name": "postgres", "port": 5432, "targetPort": 5432}]}, DB_LABEL))
items.append(resource("Deployment", "demo-postgres", {"replicas": 1, "revisionHistoryLimit": 2,
    "strategy": {"type": "Recreate"}, "selector": {"matchLabels": DB_LABEL}, "template": {
        "metadata": {"labels": DB_LABEL}, "spec": {"automountServiceAccountToken": False, "terminationGracePeriodSeconds": 90,
            "nodeSelector": {"kubernetes.io/hostname": NODE_NAME}, "securityContext": {"seccompProfile": {"type": "RuntimeDefault"}},
            "initContainers": [permissions("data", 999)],
            "containers": [{"name": "postgres", "image": POSTGRES, "args": ["-c", "shared_buffers=96MB", "-c", "max_connections=40", "-c", "work_mem=2MB"],
                "securityContext": {**security, "runAsNonRoot": True, "runAsUser": 999, "runAsGroup": 999},
                "env": [{"name": "PGDATA", "value": "/var/lib/postgresql/data/pgdata"}, {"name": "POSTGRES_USER", "value": "aidscaler"},
                        {"name": "POSTGRES_DB", "value": "aidscaler_demo"}, {"name": "POSTGRES_PASSWORD", "valueFrom": {"secretKeyRef": {"name": SECRET_NAME, "key": "POSTGRES_PASSWORD"}}}],
                "ports": [{"containerPort": 5432}], "resources": {"requests": {"cpu": "150m", "memory": "256Mi"}, "limits": {"cpu": "1", "memory": "1Gi"}},
                "startupProbe": {"exec": {"command": ["pg_isready", "-U", "aidscaler", "-d", "aidscaler_demo"]}, "periodSeconds": 5, "timeoutSeconds": 5, "failureThreshold": 30},
                "readinessProbe": {"exec": {"command": ["pg_isready", "-U", "aidscaler", "-d", "aidscaler_demo"]}, "periodSeconds": 5, "timeoutSeconds": 5},
                "livenessProbe": {"exec": {"command": ["pg_isready", "-U", "aidscaler", "-d", "aidscaler_demo"]}, "periodSeconds": 30, "timeoutSeconds": 5, "failureThreshold": 6},
                "volumeMounts": [{"name": "data", "mountPath": "/var/lib/postgresql/data"}, {"name": "socket", "mountPath": "/var/run/postgresql"}, {"name": "tmp", "mountPath": "/tmp"}]}],
            "volumes": [{"name": "data", "persistentVolumeClaim": {"claimName": "demo-postgres"}}, {"name": "socket", "emptyDir": {}}, {"name": "tmp", "emptyDir": {"sizeLimit": "128Mi"}}]}}}, DB_LABEL))

install = """set -eu
cat /source/part-* | tar -xz -C /app
mkdir -p /app/tools /app/cache
npm install --prefix /app/tools --no-audit --no-fund --cache /app/cache pnpm@11.25.0
for project in disaster-response-simulator nexo-platform; do
  cd /app/$project
  node /app/tools/node_modules/pnpm/bin/pnpm.cjs install --prod --frozen-lockfile --store-dir /app/pnpm-store
done
"""
items.append(resource("Service", "demo", {"selector": LABEL, "ports": [{"name": "http", "port": 8080, "targetPort": "http"}]}))
items.append(resource("Deployment", "demo", {"replicas": 1, "revisionHistoryLimit": 3, "strategy": {"type": "Recreate"},
    "selector": {"matchLabels": LABEL}, "template": {"metadata": {"labels": LABEL, "annotations": {"aidscaler.io/demo-revision": revision}},
    "spec": {"automountServiceAccountToken": False, "terminationGracePeriodSeconds": 120,
        "nodeSelector": {"kubernetes.io/hostname": NODE_NAME}, "securityContext": {"seccompProfile": {"type": "RuntimeDefault"}, "fsGroup": 1000},
        "initContainers": [permissions("data", 1000), {"name": "install-release", "image": NODE, "command": ["sh", "-c", install],
            "securityContext": {**security, "runAsNonRoot": True, "runAsUser": 1000, "runAsGroup": 1000},
            "resources": {"requests": {"cpu": "250m", "memory": "256Mi"}, "limits": {"cpu": "1", "memory": "1Gi"}},
            "env": [{"name": "HOME", "value": "/app"}],
            "volumeMounts": [{"name": "app", "mountPath": "/app"}, {"name": "source", "mountPath": "/source", "readOnly": True}, {"name": "tmp", "mountPath": "/tmp"}]}],
        "containers": [{"name": "demo", "image": NODE, "workingDir": "/app/nexo-platform", "command": ["node", "scripts/demo-server.mjs"],
            "securityContext": {**security, "runAsNonRoot": True, "runAsUser": 1000, "runAsGroup": 1000},
            "envFrom": [{"secretRef": {"name": SECRET_NAME}}],
            "env": [{"name": key, "value": value} for key, value in {
                "NODE_ENV": "production", "HOME": "/tmp", "DATA_DIR": "/data/demo", "AIDSCALER_LOCAL_DIR": "/data/demo/config", "DEMO_HOST": "0.0.0.0", "DEMO_PORT": "8080",
                "DEMO_ORIGIN": "https://aidscaler.com", "DEMO_MAX_ACTIVE": "4", "DEMO_MAX_TEAMS_TOTAL": "100",
                "DEMO_ALLOW_BUILD_UPGRADE": os.environ.get("DEMO_ALLOW_BUILD_UPGRADE", "false"),
                "DEMO_ARCHIVE_FENCED_BASES": os.environ.get("DEMO_ARCHIVE_FENCED_BASES", "false"),
                "DEMO_MIGRATE_OPERATIONAL_CONFIG": os.environ.get("DEMO_MIGRATE_OPERATIONAL_CONFIG", "false"),
                "DEMO_MODEL_HOURLY_USD": "1", "DEMO_MODEL_TOTAL_USD": "15", "DEMO_MODEL_CONCURRENCY": "2",
                "MODEL_ID": "google/gemma-4-31b-it", "MODEL_MAX_OUTPUT_TOKENS": "8192",
                "NODE_OPTIONS": "--max-old-space-size=2304"}.items()],
            "ports": [{"name": "http", "containerPort": 8080}],
            "resources": {"requests": {"cpu": "500m", "memory": "768Mi"}, "limits": {"cpu": "2", "memory": "4Gi"}},
            "startupProbe": {"httpGet": {"path": "/demo/api/health", "port": "http"}, "periodSeconds": 5, "failureThreshold": 90, "timeoutSeconds": 4},
            "readinessProbe": {"httpGet": {"path": "/demo/api/health", "port": "http"}, "periodSeconds": 10, "timeoutSeconds": 4},
            "livenessProbe": {"httpGet": {"path": "/healthz", "port": "http"}, "periodSeconds": 30, "timeoutSeconds": 6, "failureThreshold": 5},
            "volumeMounts": [{"name": "app", "mountPath": "/app", "readOnly": True}, {"name": "data", "mountPath": "/data"}, {"name": "tmp", "mountPath": "/tmp"}]}],
        "volumes": [{"name": "app", "emptyDir": {"sizeLimit": "1Gi"}}, {"name": "source", "projected": {"sources": volumes}},
                    {"name": "data", "persistentVolumeClaim": {"claimName": "demo-data"}}, {"name": "tmp", "emptyDir": {"sizeLimit": "256Mi"}}]}}}))

items.append(resource("NetworkPolicy", "demo-ingress", {"podSelector": {"matchLabels": LABEL}, "policyTypes": ["Ingress"],
    "ingress": [{"from": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "aidscaler-landing"}}}], "ports": [{"protocol": "TCP", "port": 8080}]}]}))
items.append(resource("NetworkPolicy", "demo-postgres-ingress", {"podSelector": {"matchLabels": DB_LABEL}, "policyTypes": ["Ingress"],
    "ingress": [{"from": [{"podSelector": {"matchLabels": LABEL}}], "ports": [{"protocol": "TCP", "port": 5432}]}]}, DB_LABEL))
print(json.dumps({"apiVersion": "v1", "kind": "List", "items": items}))

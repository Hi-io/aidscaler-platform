FROM node:24.19.0-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app/nexo-platform
COPY platform/package.json platform/pnpm-lock.yaml platform/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY platform/ ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 \
    && python3 -m venv /app/nexo-platform/.local/asr-venv \
    && /app/nexo-platform/.local/asr-venv/bin/pip install --no-cache-dir -r requirements-media.txt \
    && mkdir -p /tmp/aidscaler \
    && chown node:node /tmp/aidscaler \
    && rm -rf /var/lib/apt/lists/*
COPY simulator/sources/cloud-wire.mjs /app/disaster-response-simulator/sources/cloud-wire.mjs
COPY viewer/ /app/viewer/
ENV NODE_ENV=production PORT=8080
ENV ASR_CACHE=/tmp/aidscaler/asr
USER node
CMD ["node","scripts/gcp-server.mjs"]

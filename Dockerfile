FROM node:22-bookworm-slim AS runtime-base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv tini && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/engine && /opt/engine/bin/pip install --no-cache-dir yt-dlp==2026.11.23 \
 && /opt/engine/bin/yt-dlp --version && ffmpeg -version && ffprobe -version
ENV PYTHON_BIN=/opt/engine/bin/python
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM runtime-base AS production
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=10000 TEMP_DIR=/tmp/linkora
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]

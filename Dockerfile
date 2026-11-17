# syntax=docker/dockerfile:1.7
# One image for both services: `app` (web, API, terminal) and `worker` (editing queue).
# Build context "orc" must point at an OpenRoughCut checkout (compose.build.yml sets it).

ARG NODE_VERSION=24

# ---- whisper.cpp: local speech recognition ---------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS whisper
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG WHISPER_CPP_VERSION=v1.8.7
RUN git clone --depth 1 --branch ${WHISPER_CPP_VERSION} https://github.com/ggml-org/whisper.cpp /src/whisper.cpp
WORKDIR /src/whisper.cpp
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build build -j --config Release --target whisper-cli \
 && install -m 755 build/bin/whisper-cli /usr/local/bin/whisper-cli

# ---- web interface (React + shadcn/ui, built to static files) ---------------
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

# ---- node dependencies (node-pty is native) --------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/cutroom
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates curl git bash procps less nano tini unzip python3 python3-venv \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 \
      libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 fonts-noto-color-emoji fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# The editing agents. The user signs in with their own subscription inside the
# container; the app never reads or forwards their credentials.
ARG CLAUDE_CODE_VERSION=2.1.325
ARG CODEX_VERSION=0.169.0
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} \
 && npm cache clean --force

COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli

# HyperFrames (HeyGen, Apache 2.0): a clip engine for full-frame motion scenes.
# The CLI at a pinned version and its agent skills from the same release tag.
ARG HYPERFRAMES_VERSION=0.9.34
RUN npm install -g hyperframes@${HYPERFRAMES_VERSION} && npm cache clean --force \
 && mkdir -p /opt/cutroom/engines/hyperframes/skills /tmp/hf \
 && curl -fsSL "https://codeload.github.com/heygen-com/hyperframes/tar.gz/refs/tags/v${HYPERFRAMES_VERSION}" | tar -xz -C /tmp/hf \
 && for skill in hyperframes hyperframes-cli hyperframes-registry; do cp -r /tmp/hf/*/skills/$skill /opt/cutroom/engines/hyperframes/skills/; done \
 && cp /tmp/hf/*/LICENSE /opt/cutroom/engines/hyperframes/LICENSE \
 && rm -rf /tmp/hf
ENV HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 HYPERFRAMES_SKIP_SKILLS=1

# Face detection for graphics layout: OpenCV with the YuNet model (MIT, opencv_zoo).
ARG OPENCV_VERSION=4.10.0.84
ARG NUMPY_VERSION=2.1.3
ARG YUNET_SHA256=8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
RUN python3 -m venv /opt/cutroom/py \
 && /opt/cutroom/py/bin/pip install --no-cache-dir numpy==${NUMPY_VERSION} opencv-python-headless==${OPENCV_VERSION} \
 && mkdir -p /opt/cutroom/models \
 && curl -fsSL -o /opt/cutroom/models/face_detection_yunet_2023mar.onnx \
      https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
 && echo "${YUNET_SHA256}  /opt/cutroom/models/face_detection_yunet_2023mar.onnx" | sha256sum -c -

WORKDIR /opt/cutroom
COPY --from=deps /opt/cutroom/node_modules ./node_modules
COPY --from=orc packages/core ./node_modules/@openroughcut/core
# Chrome Headless Shell for Remotion; its path is recorded for every process,
# whatever the working directory (the agent runs `cutroom` in version folders).
RUN node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())" \
 && find / -xdev -type f \( -name chrome-headless-shell -o -name headless_shell \) -perm -u+x 2>/dev/null | head -1 > /opt/cutroom/.browser-path \
 && cat /opt/cutroom/.browser-path \
 && test -s /opt/cutroom/.browser-path
COPY package.json ./
COPY gfx ./gfx
COPY src ./src
COPY tools ./tools
COPY packs ./packs
COPY sounds ./sounds
COPY --from=web /web/dist ./web/dist
COPY instructions ./instructions
RUN chmod +x src/cli.js && ln -s /opt/cutroom/src/cli.js /usr/local/bin/cutroom

# All user data lives in /data (one volume); the agent's HOME keeps CLI sign-ins.
RUN mkdir -p /data/home && chown -R node:node /data
ENV NODE_ENV=production \
    CUTROOM_DATA=/data \
    HOME=/data/home \
    DISABLE_AUTOUPDATER=1 \
    PORT=8080
USER node
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]

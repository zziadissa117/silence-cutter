# The Cutter server (server/README.md): the Cutter app, built here, run in
# Chrome for Testing - Google's Chrome, which reads and writes H.264 - by
# server/main.mjs. At the top of the repo so Railway builds it with nothing
# set: it uses a Dockerfile it finds there by itself (its config files, that
# pointed at server/Dockerfile, can't be turned on for new services since
# 2026-08-28). The app is the very code the phone runs.

FROM node:22-bookworm-slim

# Chrome's own needs (its deb.deps), ffmpeg for HEVC clips, and fonts: the
# Snapchat look's system font falls back to Liberation, emoji to Noto.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip ffmpeg \
      fonts-liberation fonts-noto-color-emoji fonts-noto-core \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libcurl4 libdbus-1-3 libexpat1 \
      libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libudev1 libvulkan1 libx11-6 libxcb1 \
      libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# A fixed Chrome version, so a rebuild never changes how videos are made.
ARG CHROME_VERSION=138.0.7204.168
RUN curl -fsSL -o /tmp/chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
  && unzip -q /tmp/chrome.zip -d /opt \
  && mv /opt/chrome-linux64 /opt/chrome \
  && rm /tmp/chrome.zip

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build

ENV CHROME_PATH=/opt/chrome/chrome DATA_DIR=/data DIST_DIR=/app/dist NODE_ENV=production
CMD ["node", "server/main.mjs"]

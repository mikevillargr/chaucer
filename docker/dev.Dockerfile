FROM rust:1-trixie
COPY --from=node:22-trixie-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-trixie-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
      libssl-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libdbus-1-dev pkg-config build-essential file \
 && rm -rf /var/lib/apt/lists/*
ENV CARGO_HOME=/cache/cargo CARGO_TARGET_DIR=/cache/target npm_config_cache=/cache/npm
WORKDIR /app

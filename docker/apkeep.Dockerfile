FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates apksigner unzip apktool aapt imagemagick \
 && rm -rf /var/lib/apt/lists/*

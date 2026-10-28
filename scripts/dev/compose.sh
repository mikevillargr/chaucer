#!/usr/bin/env bash
# Run the development containers on the Paseo VPS, directly or from its agent container.
set -euo pipefail
if command -v docker >/dev/null 2>&1; then
  cd "$(dirname "$0")/../.."
  exec docker compose -f compose.dev.yml "$@"
fi
printf -v quoted_args ' %q' "$@"
exec ssh -i /home/paseo/.ssh/paseo_shared -o IdentitiesOnly=yes root@187.127.107.41 \
  "cd '/srv/projects/Gmail Desktop' && docker compose -f compose.dev.yml${quoted_args}"

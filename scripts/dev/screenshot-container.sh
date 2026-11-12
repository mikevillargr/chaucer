#!/usr/bin/env bash
# Run a browser check locally on the Docker host, or via CHECK_SSH_HOST (SSH config).
# For SSH, CHECK_SOURCE_DIR is the host-side repo path; /workspace maps to /srv/projects.
# CHECK_SSH_IDENTITY optionally selects an identity when no SSH config alias exists.
# CHECK_TIMEOUT is in seconds (default: 20 minutes), including dependency installation.
set -euo pipefail
if (( $# != 3 )); then
  echo "Usage: $0 <script.mjs> <preview-url> <container-output-dir>" >&2
  exit 2
fi
script=$1
[[ $script =~ ^[a-zA-Z0-9-]+\.mjs$ ]] || exit 2
source_dir=$(cd "$(dirname "$0")/../.." && pwd)
if [[ -n ${CHECK_SSH_HOST:-} ]]; then
  source_dir=${CHECK_SOURCE_DIR:-${source_dir/#\/workspace/\/srv/projects}}
fi
name="chaucer-${script%.mjs}-$(date +%s)-$$-${RANDOM}"
ssh_args=(-o BatchMode=yes -o ConnectTimeout=10)
if [[ -n ${CHECK_SSH_IDENTITY:-} ]]; then
  ssh_args+=(-i "$CHECK_SSH_IDENTITY" -o IdentitiesOnly=yes)
fi
host_docker() {
  if [[ -n ${CHECK_SSH_HOST:-} ]]; then
    local command
    printf -v command ' %q' docker "$@"
    ssh "${ssh_args[@]}" "$CHECK_SSH_HOST" "$command"
  else
    docker "$@"
  fi
}
pid=
cleanup() {
  [[ -z $pid ]] || kill "$pid" 2>/dev/null || true
  host_docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Background + wait lets Bash handle signals while Docker/SSH is still running.
docker_args=(run --rm --init --name "$name" --label paseo.temp=true \
  --add-host host:host-gateway -v "$source_dir:/app" -w /tmp \
  mcr.microsoft.com/playwright:v1.56.0-noble \
  timeout -k 30 "${CHECK_TIMEOUT:-1200}" sh -c \
  'npm i -s playwright@1.56.0 >/dev/null && cp "/app/scripts/dev/$1" /tmp/check.mjs && node /tmp/check.mjs "$2" "$3"' \
  sh "$script" "$2" "$3")
if [[ -n ${CHECK_SSH_HOST:-} ]]; then
  printf -v command ' %q' docker "${docker_args[@]}"
  ssh "${ssh_args[@]}" "$CHECK_SSH_HOST" "$command" &
else
  docker "${docker_args[@]}" &
fi
pid=$!
wait "$pid"
pid=

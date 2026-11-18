#!/usr/bin/env bash
# One-time Cloudflare setup inside a throwaway Podman container.
#
# Nothing from npm runs on your machine: the container installs the project's
# dependencies into its own volume and runs scripts/setup/cloudflare.ts. Your
# machine needs only Podman and this repository.
#
# Usage, from anywhere in the repository:
#   scripts/setup/podman.sh [--new-code] [--new-sheet-url] [--deploy]
#
# The Cloudflare API token and account ID are asked for once (or taken from
# CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID). They are passed to the
# container through the environment, never on a command line.
set -euo pipefail

# Official Node image, pinned by digest. To update: look up the digest of the
# new tag (podman pull docker.io/library/node:<tag>; podman image inspect).
IMAGE='docker.io/library/node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc'
# Keeps node_modules between runs, separate from any node_modules on the host.
VOLUME='sprzatanie-setup-node-modules'

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

if ! command -v podman > /dev/null; then
  echo 'Podman is not installed: https://podman.io/docs/installation' >&2
  exit 1
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  read -rsp 'Cloudflare API token (docs/DEPLOYMENT.md, step 4): ' CLOUDFLARE_API_TOKEN
  echo
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  read -rp 'Cloudflare account ID: ' CLOUDFLARE_ACCOUNT_ID
fi
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# --userns=keep-id: files the container writes (wrangler.jsonc) stay yours.
# :Z relabels for SELinux; :U hands the volume to the container user.
exec podman run --rm -it \
  --userns=keep-id \
  --volume "$PWD:/app:Z" \
  --volume "$VOLUME:/app/node_modules:U" \
  --workdir /app \
  --env CLOUDFLARE_API_TOKEN \
  --env CLOUDFLARE_ACCOUNT_ID \
  --env HOME=/tmp/home \
  --env npm_config_cache=/tmp/npm-cache \
  --env npm_config_update_notifier=false \
  --env WRANGLER_SEND_METRICS=false \
  "$IMAGE" \
  sh -c 'npm ci --ignore-scripts --no-audit --no-fund && exec node scripts/setup/cloudflare.ts "$@"' \
  setup "$@"

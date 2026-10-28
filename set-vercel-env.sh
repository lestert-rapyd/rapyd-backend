#!/usr/bin/env bash
# Push the backend's secrets/config from ./.env into Vercel in one shot.
# Values are read from .env at runtime and piped straight to `vercel env`
# — they are never printed. Re-runnable (removes then re-adds each var).
#
# Picked up (names only, from .env — see .env.example for what each does):
#   RAPYD_SC<n>_*, RAPYD_SANDBOX_*, RAPYD_LIVE_*, PAYBRIDGE_LIVE_TOKEN,
#   ALLOWED_ORIGINS, LIVE_MAX_AMOUNT, WEBHOOK_REQUIRE_SIGNATURE, WEBHOOK_PUBLIC_URL
# NOT pushed: PORT (local only) and KV_*/UPSTASH_* (Vercel injects those when
# the KV store is connected to the project). Empty assignments are skipped.
#
# Prereqs (yours — they use your credentials):
#   vercel login
#   vercel link          # run once in this dir to bind the project
#
# Usage:
#   ./set-vercel-env.sh                       # -> production preview
#   ./set-vercel-env.sh production            # one target
#   ./set-vercel-env.sh production preview development
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "no .env here ($(pwd))"; exit 1; }
[ -d .vercel ] || { echo "project not linked — run:  vercel link"; exit 1; }

TARGETS=("$@"); [ ${#TARGETS[@]} -eq 0 ] && TARGETS=(production preview)

# discover the var names actually present in .env (no values echoed)
NAME_RE='^(RAPYD_SC[0-9]+_[A-Z_]+|RAPYD_SANDBOX_[A-Z_]+|RAPYD_LIVE_[A-Z_]+|PAYBRIDGE_LIVE_TOKEN|ALLOWED_ORIGINS|LIVE_MAX_AMOUNT|WEBHOOK_REQUIRE_SIGNATURE|WEBHOOK_PUBLIC_URL)='
VARS=()
while IFS= read -r v; do [ -n "$v" ] && VARS+=("$v"); done < <(grep -oE "$NAME_RE" .env | sed 's/=$//' | sort -u)
[ ${#VARS[@]} -eq 0 ] && { echo "no known backend vars found in .env"; exit 1; }

echo "Setting up to ${#VARS[@]} vars on: ${TARGETS[*]}"
for name in "${VARS[@]}"; do
  # take the first assignment, strip an optional surrounding pair of quotes
  val=$(grep -E "^${name}=" .env | head -1 | cut -d= -f2-)
  val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  if [ -z "$val" ]; then echo "  - $name is empty in .env, skipped"; continue; fi
  for env in "${TARGETS[@]}"; do
    vercel env rm "$name" "$env" -y >/dev/null 2>&1 || true
    printf '%s' "$val" | vercel env add "$name" "$env" >/dev/null
    echo "  ✓ $name -> $env"
  done
done
echo "Done. Redeploy to pick them up:  vercel --prod   (and push to trigger the staging deploy)"

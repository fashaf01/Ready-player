#!/usr/bin/env bash
# Assemble the Higgsfield (Cloudflare Worker + Durable Object) version of the
# game from this repo into a Higgsfield game app folder.
#
#   scripts/build-higgsfield.sh path/to/higgsfield-repo/app
#
# Server: cloudflare/* + server/core/* + shared/*   -> app/src
# Client: public/* + shared/* + the three.js files  -> app/public
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$(cd "$1" && pwd)"

rm -rf "$APP/src/cloudflare" "$APP/src/server" "$APP/src/shared" \
  "$APP/src/logic.js" "$APP/src/logic.d.ts" "$APP/src/protocol.ts" "$APP/tests"
mkdir -p "$APP/src/cloudflare" "$APP/src/server/core" "$APP/src/shared"
cp "$ROOT"/cloudflare/world.js "$ROOT"/cloudflare/world.d.ts "$ROOT"/cloudflare/store-do.js "$ROOT"/cloudflare/store-kv.js "$APP/src/cloudflare/"
cp "$ROOT"/cloudflare/room.ts "$ROOT"/cloudflare/worker.ts "$APP/src/"
cp "$ROOT"/server/core/*.js "$APP/src/server/core/"
cp "$ROOT"/shared/*.js "$APP/src/shared/"

rm -rf "$APP/public"
mkdir -p "$APP/public/shared" "$APP/public/vendor/three/build" "$APP/public/vendor/three/examples/jsm"
cp -r "$ROOT"/public/. "$APP/public/"
cp "$ROOT"/shared/*.js "$APP/public/shared/"
T="$ROOT/node_modules/three"
cp "$T/build/three.module.js" "$T/build/three.core.js" "$APP/public/vendor/three/build/"
cp -r "$T/examples/jsm/postprocessing" "$T/examples/jsm/shaders" "$APP/public/vendor/three/examples/jsm/"

echo "assembled THE HUNT into $APP"

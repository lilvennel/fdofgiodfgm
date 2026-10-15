#!/bin/sh
set -eu
mkdir -p "${DATA_DIR:-/data}/uploads"
chown -R node:node "${DATA_DIR:-/data}"
exec su-exec node node /app/server.js

#!/bin/sh
set -eu

DATA="${DATA_DIR:-/data}"

# Volume de Railway suele montarse como root; el proceso corre como node.
# Hay que crear carpetas y ceder ownership antes de bajar de privilegios.
mkdir -p "$DATA/uploads" "$DATA/backups" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA" 2>/dev/null || true
  # Asegurar permisos de escritura en la raíz del volume
  chmod u+rwx "$DATA" 2>/dev/null || true
  exec su-exec node node /app/server.js
fi

# Si ya no somos root, intentar igual
exec node /app/server.js

FROM node:22-alpine

WORKDIR /app

# su-exec: arrancar como root, arreglar permisos del volume y bajar a node
RUN apk add --no-cache su-exec wget

COPY package.json server.js ./
COPY lib ./lib
COPY routes ./routes
COPY scripts ./scripts
COPY public ./public
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data

# Placeholder en la imagen (el volume de Railway lo reemplaza en runtime)
RUN mkdir -p /data/uploads && chown -R node:node /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

# Importante: NO poner USER node acá.
# El entrypoint corre como root, hace chown del volume montado y luego ejecuta como node.
ENTRYPOINT ["/docker-entrypoint.sh"]

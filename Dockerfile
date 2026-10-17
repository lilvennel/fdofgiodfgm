FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY routes ./routes
COPY scripts ./scripts
COPY public ./public

ENV NODE_ENV=production PORT=3000 DATA_DIR=/data

# Crear la carpeta y darle ownership al usuario node ANTES de cambiar de usuario
RUN mkdir -p /data/uploads && chown -R node:node /data

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "server.js"]

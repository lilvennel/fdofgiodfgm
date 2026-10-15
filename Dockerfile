FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package.json server.js ./
COPY lib ./lib
COPY routes ./routes
COPY scripts ./scripts
COPY public ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
# Railway mounts /data at runtime; entrypoint fixes volume ownership before dropping privileges.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/healthz || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]

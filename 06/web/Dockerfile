FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js lib.js views.js ./
COPY --chown=node:node public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]

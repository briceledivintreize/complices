# Image pour tout hébergeur qui accepte Docker (Fly.io, Railway, un VPS…).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY decks ./decks

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]

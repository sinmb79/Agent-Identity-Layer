# 22B Labs AIL Issuance Server
# Node.js 22+ required for built-in node:sqlite

FROM node:22-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server/ ./server/
COPY sdk/ ./sdk/

# SQLite database directory (mount a persistent volume here in production)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

CMD ["node", "server/index.mjs"]

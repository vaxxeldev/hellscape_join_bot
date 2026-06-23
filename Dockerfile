FROM node:24-bookworm-slim AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/flood_games.sqlite

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /usr/src/app/dist ./dist
COPY migrations ./migrations
COPY roles ./roles
COPY messages_banner_gif ./messages_banner_gif
COPY premium_emoji.json ./
COPY .env.example ./.env.example

RUN mkdir -p /app/data /usr/src/app/data && chown -R node:node /app/data /usr/src/app

USER node

CMD ["node", "dist/index.js"]

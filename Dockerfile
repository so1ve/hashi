FROM --platform=$BUILDPLATFORM node:24-slim AS deps

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-slim

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY migrations ./migrations

VOLUME ["/data"]
EXPOSE 8787

ENV HOST=0.0.0.0
ENV PORT=8787
ENV HASHI_DB_PATH=/data/hashi.db

CMD ["node", "src/entry/node.ts"]

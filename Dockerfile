FROM oven/bun:1.3.3-alpine AS install
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=install /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["bun", "run", "start"]

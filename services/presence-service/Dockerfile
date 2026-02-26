FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE 4002
CMD ["bun", "run", "index.ts"]

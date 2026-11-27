# Mochi Moon: game server + web client in one image.
# The Node server (src/server) runs the fights and also serves the built client (dist/).
# Build:  docker build -t mochi-moon .
# Run:    docker run -p 8787:8787 -v mochi-data:/app/data mochi-moon

# ---- build the web client ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# tsx (a dev dependency) runs the TypeScript server, so dev dependencies are installed too
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY --from=build /app/dist ./dist
RUN mkdir -p data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
# Saved builds, fights and replays are written to /app/data/db.json. Mount a volume there to keep them
# (docker compose does; on Railway attach a volume at /app/data). No VOLUME line: Railway does not allow it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1
CMD ["npx", "tsx", "src/server/index.ts"]

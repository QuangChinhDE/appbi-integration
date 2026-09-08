# The n8n engine service.
#
# Two stages so the runtime image carries no TypeScript toolchain and no dev
# dependencies. `npm ci` in both, never `npm install`: the lockfile is the pin
# that ADR-013 depends on, and an install that resolves fresh versions would
# quietly defeat it.

FROM node:22.20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json


FROM node:22.20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    ENGINE_HOST=0.0.0.0 \
    ENGINE_PORT=8099

COPY package.json package-lock.json ./
# `--omit=dev` and `--ignore-scripts`: nothing in the pinned tree needs a
# post-install step at runtime, and a build script running as part of a
# production image start-up is a supply-chain surface for no benefit.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

# Non-root. The engine executes third-party HTTP calls; it has no reason to be
# able to write to its own image.
USER node

EXPOSE 8099

# No public route exists, so the health check speaks the internal contract --
# including the shared token, which the container gets from the environment.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const http=require('http');const r=http.request({host:'127.0.0.1',port:process.env.ENGINE_PORT||8099,path:'/internal/readyz',headers:{'X-Engine-Token':process.env.ENGINE_INTERNAL_TOKEN||''}},(s)=>process.exit(s.statusCode===200?0:1));r.on('error',()=>process.exit(1));r.end();"

CMD ["node", "dist/src/server.js"]

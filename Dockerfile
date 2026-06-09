# --- Build stage ---
FROM oven/bun:1.3.14-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY tsconfig.json ./
# --bytecode: move o parse JS→bytecode para build-time (startup ~2x mais rápido — bun docs:
#   handbook/references/bun/bundler/executables.mdx:319-358).
# --sourcemap: embute sourcemap (zstd) p/ stacktraces apontarem o código original.
# --format=esm: obrigatório aqui — o bootstrap (src/index.ts) usa top-level await, que o
#   default CJS do --bytecode não suporta.
RUN bun build --compile --minify --sourcemap --bytecode --format=esm ./src/index.ts --outfile people-context

# --- Runtime stage ---
FROM gcr.io/distroless/cc-debian12
LABEL org.opencontainers.image.source="https://github.com/acdgbrasil/svc-people-context"
LABEL org.opencontainers.image.description="People Context — Central identity registry for the ACDG ecosystem"
LABEL org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=build /app/people-context ./people-context
EXPOSE 3000
CMD ["./people-context"]

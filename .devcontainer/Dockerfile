# gbrain dev container — Bun toolchain, isolated from the host.
# Base image floats with `oven/bun:1` to track the version CI runs
# (docker-compose.ci.yml uses the same image for its runner service).
FROM oven/bun:1

# git: needed for /ship and general repo work inside the container.
# ca-certificates + curl: TLS for API calls (OpenAI/Anthropic) and downloads.
# postgresql-client: psql for poking at the pgvector DB when running E2E.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps install at postCreateCommand time (see devcontainer.json) so the
# named node_modules volume is mounted first. Nothing to COPY here — the
# workspace is bind-mounted.

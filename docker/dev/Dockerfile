# === Base image: Bun toolchain (Debian-based) ===
# Floats with `oven/bun:1` to track the version CI runs.
FROM oven/bun:1

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# === System packages ===
# git/curl/wget/ca-certificates: repo work + TLS for OpenAI/Anthropic.
# postgresql-client: psql for poking at the pgvector DB during E2E.
# terminator/dbus/x11 libs: the GUI terminal we work inside.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    ca-certificates \
    postgresql-client \
    terminator \
    dbus \
    dbus-x11 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# === Working directory (repo is bind-mounted here by docker-compose) ===
WORKDIR /app

# === Terminator GUI config ===
RUN mkdir -p /root/.config/terminator
COPY docker/dev/terminator_config /root/.config/terminator/config

# === Coloured, interactive bash ===
ENV TERM=xterm-256color
RUN if [ -f /etc/skel/.bashrc ]; then \
        cp /etc/skel/.bashrc /root/.bashrc && \
        sed -i 's/#force_color_prompt=yes/force_color_prompt=yes/' /root/.bashrc ; \
    fi

# Put the compiled binary (built into the bind-mounted /app/bin by
# install-dependencies.sh) and Bun's global bin on PATH.
ENV PATH="/app/bin:/root/.bun/bin:$PATH"

ENTRYPOINT []
CMD ["/bin/bash"]

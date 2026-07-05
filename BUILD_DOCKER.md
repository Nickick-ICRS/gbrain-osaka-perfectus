# 1. Build the image (once, or after Dockerfile changes)
./BUILD-DOCKER-IMAGE.sh

# 2. Bring it up — opens a terminator GUI window AND drops you into a shell
./RUN-DOCKER-CONTAINER.sh

# 3. First time inside the container: install deps + build the binary
bash install-dependencies.sh

# 4. Work — the binary is on PATH:
gbrain --help
gbrain init --pglite
bun run dev --help        # or run from source

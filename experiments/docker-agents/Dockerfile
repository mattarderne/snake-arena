# NOTE: This Dockerfile was copied from snake-arena-backend/experiments/pi-docker/
# and needs updating before it can build from this repo.
#   - COPY cli/ assumes snake-arena CLI source at ./cli/ (from snake-arena-backend)
#   - COPY kurve_engine.py/kurve_wrapper.py assume arena-backend files at build root
#   - COPY experiments/pi-docker/AGENTS.md path needs adjusting
# For now, build from the snake-arena-backend repo:
#   cd snake-arena-backend && docker build -t snake-arena-pi-experiment -f experiments/pi-docker/Dockerfile .

FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    git curl bash procps \
    && rm -rf /var/lib/apt/lists/*

# Pi coding agent — pinned to last version supporting --provider openrouter
RUN npm install -g @mariozechner/pi-coding-agent@0.54.2

# Snake-arena CLI — install from the local cli submodule (copied in at build time)
WORKDIR /snake-arena-cli
COPY cli/ .
RUN npm install && npm link

# Workspace for the agent
WORKDIR /workspace
COPY experiments/pi-docker/AGENTS.md .
COPY kurve_engine.py .
COPY kurve_wrapper.py .

# Pi config dir
RUN mkdir -p /root/.pi/agent

ENTRYPOINT ["pi", "--mode", "rpc", "--no-session", "--provider", "openrouter"]

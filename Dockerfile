FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:/app/node_modules/.bin:${PATH}"

# System dependencies for Python + OpenCV + FFmpeg + FiftyOne
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    wget \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    rsync \
    && rm -rf /var/lib/apt/lists/*

# Install libssl1.1 from Ubuntu archive for legacy binary compatibility
RUN wget -O /tmp/libssl1.1.deb http://archive.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2_amd64.deb \
    && dpkg -i /tmp/libssl1.1.deb \
    && rm /tmp/libssl1.1.deb

# Isolate Python packages to avoid system-managed environment conflicts
RUN python3 -m venv "${VIRTUAL_ENV}" \
    && "${VIRTUAL_ENV}/bin/python" -m pip install --upgrade pip

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Python dependencies for FiftyOne worker
RUN "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir \
    opencv-python-headless \
    numpy

# Application code
COPY . .

# Provide defaults when no env file is mounted
RUN if [ ! -f .env ]; then cp .env.example .env; fi

# Build Next.js app
RUN npm run build

# Ensure dataset directory exists inside the image
RUN mkdir -p /data/datasets

# Create deletion logs directory for FiftyOne custom operator
RUN mkdir -p /app/deletion_logs

EXPOSE 3000

CMD ["npm", "start"]

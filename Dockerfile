FROM python:3.11-slim

# OpenCV headless needs these system libs
RUN apt-get update && apt-get install -y \
    libglib2.0-0 libsm6 libxext6 libxrender1 libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer cache)
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy everything else
COPY . .

EXPOSE 8080
CMD cd backend && gunicorn app:app --bind 0.0.0.0:${PORT:-8080} --workers 1 --timeout 120

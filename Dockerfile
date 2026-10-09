FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libgomp1 libxrender1 libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-web.txt .
RUN pip install --no-cache-dir -r requirements-web.txt
COPY fluixel/ ./fluixel/
COPY vendor/models/ ./vendor/models/
COPY VERSION ./VERSION
RUN useradd --create-home --uid 10001 fluixer
USER fluixer
EXPOSE 10000
# One process keeps the admission limit effective for expensive geometry work.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --worker-class gthread --threads 4 --timeout 120 --graceful-timeout 30 --access-logfile - --error-logfile - 'fluixel.website:create_app()'"]

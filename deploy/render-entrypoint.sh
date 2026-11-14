#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

PORT="${PORT:-8000}"
echo "Starting web server on port ${PORT}..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --proxy-headers \
  --forwarded-allow-ips="*"


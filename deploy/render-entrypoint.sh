#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

if [ "${FK_CREATE_DEMO:-}" = "true" ]; then
  echo "Creating public demo shop..."
  python -m app.cli create-demo --yes
fi

PORT="${PORT:-8000}"
echo "Starting web server on port ${PORT}..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --proxy-headers \
  --forwarded-allow-ips="*"


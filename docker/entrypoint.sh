#!/usr/bin/env bash
set -e

# Wait for the database to accept connections (best-effort).
if [ -n "$DB_HOST" ]; then
  echo "Waiting for database at ${DB_HOST}:${DB_PORT:-3306}..."
  for i in $(seq 1 30); do
    if mysqladmin ping -h"$DB_HOST" -P"${DB_PORT:-3306}" --silent 2>/dev/null; then
      echo "Database is up."
      break
    fi
    sleep 2
  done
fi

# Run schema migration if AUTO_MIGRATE is set.
if [ "$AUTO_MIGRATE" = "1" ]; then
  echo "Applying schema..."
  mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < /var/www/html/sql/schema.sql || true
  if [ "$SEED_GOD" = "1" ]; then
    echo "Seeding God account..."
    mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < /var/www/html/sql/seed_god.sql || true
  fi
fi

# Start cron in the background, then Apache in the foreground.
cron
exec apache2-foreground

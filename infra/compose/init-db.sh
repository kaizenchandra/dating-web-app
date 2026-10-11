#!/bin/sh
set -eu
for name in identity communication commerce_operations profile_discovery connections; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v password="$POSTGRES_PASSWORD" -v name="$name" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'name', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'name', :'name') \gexec
SQL
done

#!/usr/bin/env bash
# Run this ONCE, from the repo root, before your first `docker compose up -d`.
# After this, the `certbot` service in docker-compose.yml handles renewal on
# its own - you don't run this script again unless the domain changes or
# the volumes get wiped.
#
# Why this is needed at all: nginx.conf's 443 server block references
# /etc/letsencrypt/live/$DOMAIN/*.pem, and nginx refuses to start if those
# files don't exist - but certbot can't obtain a REAL cert until nginx is
# already up and serving the ACME challenge on port 80. This breaks that
# loop with a one-day throwaway self-signed cert, just so nginx has
# something to start with long enough for certbot to replace it for real.
set -euo pipefail

DOMAIN="YOUR_DOMAIN_HERE"   # must match nginx.conf's server_name
EMAIL="you@example.com"     # Let's Encrypt sends renewal/expiry notices here
STAGING=1                   # 1 = LE's staging environment (untrusted cert, but
                             # no rate limit risk) - flip to 0 once this runs
                             # clean end to end, then run it again for real

docker compose up -d --build server
docker compose up -d --no-deps --build client 2>/dev/null || true

echo "### Creating a temporary self-signed cert so nginx can start..."
docker compose run --rm --entrypoint "sh -c '\
  mkdir -p /etc/letsencrypt/live/$DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj \"/CN=localhost\"'" certbot

echo "### Starting nginx with the temporary cert..."
docker compose up -d client

echo "### Deleting the temporary cert (so certbot doesn't reuse it)..."
docker compose run --rm --entrypoint "sh -c '\
  rm -rf /etc/letsencrypt/live/$DOMAIN \
         /etc/letsencrypt/archive/$DOMAIN \
         /etc/letsencrypt/renewal/$DOMAIN.conf'" certbot

echo "### Requesting the real cert from Let's Encrypt..."
STAGING_ARG=""
if [ "$STAGING" != "0" ]; then STAGING_ARG="--staging"; fi

docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL -d $DOMAIN \
    --rsa-key-size 2048 --agree-tos --non-interactive" certbot

echo "### Reloading nginx with the real cert..."
docker compose exec client nginx -s reload

echo "### Done. If STAGING=1 above, this issued an untrusted staging cert -"
echo "### set STAGING=0 and rerun once you've confirmed the flow works."

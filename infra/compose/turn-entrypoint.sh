#!/bin/sh
set -eu
[ "$APP_ENV" = local ] || { echo 'This loopback relay configuration is local-only.' >&2; exit 1; }
[ "${#TURN_SHARED_SECRET}" -ge 32 ] || { echo 'Configure a local TURN secret first.' >&2; exit 1; }
umask 077
cat > /tmp/raahi-turn.conf <<EOF
listening-port=3478
realm=raahi.local
fingerprint
use-auth-secret
static-auth-secret=$TURN_SHARED_SECRET
external-ip=127.0.0.1
min-port=49160
max-port=49180
no-cli
no-tls
no-dtls
no-multicast-peers
allow-loopback-peers
user-quota=4
total-quota=40
no-software-attribute
simple-log
log-file=stdout
EOF
exec turnserver -c /tmp/raahi-turn.conf

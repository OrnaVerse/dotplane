#!/bin/bash
# Generate mTLS certificates for Dotplane Platform and Agents.
#
# Usage:
#   CERT_DIR=/opt/dotplane/certs ./generate-certs.sh
#   CERT_DIR=/opt/dotplane/certs SERVER_ID=server-mum-01 HOSTNAME=10.0.0.1 ./generate-certs.sh
#
# Outputs:
#   ca.crt, ca.key          — Certificate Authority
#   platform.crt, platform.key — Platform client cert (mTLS to agents)
#   agent.crt, agent.key    — Agent server cert (only when SERVER_ID is set)

set -euo pipefail

CERT_DIR="${CERT_DIR:-/opt/dotplane/certs}"
SERVER_ID="${SERVER_ID:-}"
HOSTNAME="${HOSTNAME:-localhost}"
VALIDITY_DAYS="${VALIDITY_DAYS:-3650}"

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

if [[ ! -f "$CERT_DIR/ca.crt" || ! -f "$CERT_DIR/ca.key" ]]; then
  openssl genrsa -out "$CERT_DIR/ca.key" 4096
  openssl req -new -x509 -days "$VALIDITY_DAYS" -key "$CERT_DIR/ca.key" \
    -out "$CERT_DIR/ca.crt" \
    -subj "/CN=Dotplane CA/O=Dotplane"
fi

if [[ ! -f "$CERT_DIR/platform.crt" || ! -f "$CERT_DIR/platform.key" ]]; then
  openssl genrsa -out "$CERT_DIR/platform.key" 2048
  openssl req -new -key "$CERT_DIR/platform.key" \
    -out "$CERT_DIR/platform.csr" \
    -subj "/CN=dotplane-platform/O=Dotplane"
  openssl x509 -req -days "$VALIDITY_DAYS" \
    -in "$CERT_DIR/platform.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -out "$CERT_DIR/platform.crt" \
    -extfile <(printf "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth")
  rm -f "$CERT_DIR/platform.csr"
fi

if [[ -n "$SERVER_ID" ]]; then
  openssl genrsa -out "$CERT_DIR/agent.key" 2048
  openssl req -new -key "$CERT_DIR/agent.key" \
    -out "$CERT_DIR/agent.csr" \
    -subj "/CN=dotplane-agent-${SERVER_ID}/O=Dotplane"
  openssl x509 -req -days "$VALIDITY_DAYS" \
    -in "$CERT_DIR/agent.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -out "$CERT_DIR/agent.crt" \
    -extfile <(printf "subjectAltName=DNS:localhost,DNS:${HOSTNAME},IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth")
  rm -f "$CERT_DIR/agent.csr"
fi

chmod 600 "$CERT_DIR"/*.key 2>/dev/null || true
chmod 644 "$CERT_DIR"/*.crt 2>/dev/null || true

echo "Certificates written to ${CERT_DIR}"

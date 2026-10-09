#!/bin/sh
# Development certificate for https://localhost (self-signed: the browser asks you to accept it once).
# For a real deployment use a certificate from your university CA or Let's Encrypt instead.
set -e
cd "$(dirname "$0")"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout certs/dev-key.pem -out certs/dev-cert.pem \
  -subj "/CN=localhost/O=CUI Connect dev" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
echo "Created certs/dev-key.pem and certs/dev-cert.pem"

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'Python 3 is required to run the local web server.\n' >&2
  exit 1
fi

python3 - "$APP_DIR" "${PORT:-}" <<'PY'
import functools
import http.server
import socketserver
import sys

directory, requested_port = sys.argv[1:]
ports = [int(requested_port)] if requested_port else [8000, 8888, 3000, 8081, 9000]

class Server(socketserver.TCPServer):
    allow_reuse_address = True

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
for port in ports:
    try:
        server = Server(("127.0.0.1", port), handler)
        break
    except OSError:
        continue
else:
    raise SystemExit("No available local port. Set PORT to another port and retry.")

print(f"Sessions is running at http://127.0.0.1:{server.server_address[1]}/", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY

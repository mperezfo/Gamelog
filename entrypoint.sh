#!/bin/sh
# Runs the two processes the image bundles: the Go backend and Caddy, which
# serves the frontend and reverse-proxies /api/* to the backend (see
# Caddyfile). Both are expected to run forever, so if either one exits —
# a crash, a database that was not ready yet — the container exits too,
# rather than leaving the other running on its own (Caddy reverse-proxying to
# a backend that is no longer there, say). That way `restart: unless-stopped`
# brings the whole container back up instead of it limping along half-alive.
#
# Polling with kill -0 rather than `wait -n`: this shell reaps a finished
# background job on its own before a script line gets a chance to wait for it,
# and if that happens to the only job still running, `wait -n` blocks forever
# waiting for a SIGCHLD that already fired.

/app/server &
server_pid=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

trap 'kill -TERM "$server_pid" "$caddy_pid" 2>/dev/null; exit 143' INT TERM

while kill -0 "$server_pid" 2>/dev/null && kill -0 "$caddy_pid" 2>/dev/null; do
	sleep 1
done

kill -TERM "$server_pid" "$caddy_pid" 2>/dev/null
exit 1

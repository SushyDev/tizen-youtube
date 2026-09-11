#!/usr/bin/env sh
#
# Build a dev widget and install it on the television through Tizen Homebrew.
#
#   ./install-dev.sh              package a dev build, then install it
#   ./install-dev.sh --no-build   install whatever is already in release/
#   TUBE_TV=192.168.1.40 ./install-dev.sh
#
# Developer Mode's Host PC IP must be 127.0.0.1, or Homebrew answers sdbUnreachable.

set -eu

TV="${TUBE_TV:-192.168.1.29}"
PORT="${TUBE_HOMEBREW_PORT:-8091}"
PIN="${TUBE_HOMEBREW_PIN:-000000}"
# Set TUBE_CHII=<laptop>:<port> to have every page carry a remote-inspector target script.
CHII="${TUBE_CHII:-}"
WGT="release/tube.wgt"

cd "$(dirname "$0")"

if [ "${1:-}" != "--no-build" ]; then
    TUBE_DEV=1 TUBE_DEV_TOKEN="${TUBE_DEV_TOKEN:?set it to the token the dev bridge should accept}" TUBE_CHII="$CHII" npm run package
fi

[ -f "$WGT" ] || { echo "No widget at $WGT — run: npm run package" >&2; exit 1; }

printf 'installing %s (%s) on %s\n' "$WGT" "$(wc -c < "$WGT" | tr -d ' ') bytes" "$TV"

answer=$(curl -sS -m 180 -X POST "http://$TV:$PORT/install" \
    -H "x-homebrew-pin: $PIN" \
    -H 'x-homebrew-name: tube.wgt' \
    -H 'content-type: application/octet-stream' \
    --data-binary "@$WGT")

printf '%s\n' "$answer"

relaunch() {
    printf 'relaunching the container'
    i=0
    while [ $i -lt 90 ]; do
        reply=$(curl -s -m 5 "http://$TV:8099/__tube/dev/relaunch" 2>/dev/null || true)
        case "$reply" in
            *'"ok":true'*) printf '\n'; sleep 3; return 0 ;;
            *'"ok":false'*) printf '\n%s\n' "$reply" >&2; return 1 ;;
        esac
        printf '.'; i=$((i + 1)); sleep 1
    done
    printf ' no answer\n' >&2
    return 1
}

wait_for_page() {
    printf 'waiting for the new page to report'
    i=0
    while [ $i -lt 90 ]; do
        case "$(curl -s -m 2 "http://$TV:8097/stats" 2>/dev/null || true)" in
            *'"stale":false'*) printf ' up\n'; return 0 ;;
        esac
        printf '.'; i=$((i + 1)); sleep 1
    done
    printf ' timed out\n' >&2
    return 1
}

case "$answer" in
    *'"ok":true'*)
        printf '\nInstalled.\n'
        if [ "${TUBE_WAIT:-1}" = "1" ]; then relaunch; wait_for_page; fi
        ;;
    *sdbUnreachable*) printf '\nSet Developer Mode Host PC IP to 127.0.0.1 on the TV and restart it.\n' >&2; exit 1 ;;
    *) printf '\nHomebrew refused the install.\n' >&2; exit 1 ;;
esac

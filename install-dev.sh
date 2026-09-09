#!/usr/bin/env sh
#
# Build a dev widget and install it on the television through Tizen Homebrew.
#
#   ./install-dev.sh              package a dev build, then install it
#   ./install-dev.sh --no-build   install whatever is already in release/
#   TUBE_TV=192.168.1.40 ./install-dev.sh
#
# Homebrew re-signs what it installs with the pair the set itself holds; that is the only way a
# widget we built is accepted, because a TV refuses an unsigned one over sdb. Its /install goes
# through sdb on the set's own loopback, so Developer Mode's Host PC IP must be 127.0.0.1 or it
# answers sdbUnreachable and retrying never clears it.
#
# It takes effect when the app is next opened — installing does not restart the running page.

set -eu

TV="${TUBE_TV:-192.168.1.29}"
PORT="${TUBE_HOMEBREW_PORT:-8091}"
PIN="${TUBE_HOMEBREW_PIN:-000000}"
TOKEN="${TUBE_DEV_TOKEN:-tvdebug2026}"
# Set TUBE_CHII=<laptop>:<port> to have every page carry a remote-inspector target script.
CHII="${TUBE_CHII:-}"
WGT="release/tube.wgt"

cd "$(dirname "$0")"

if [ "${1:-}" != "--no-build" ]; then
    TUBE_DEV=1 TUBE_DEV_TOKEN="$TOKEN" TUBE_CHII="$CHII" npm run package
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
    # Installing restarts the service but leaves the container on the bundle it already had, so a
    # new build changes nothing on screen until the container itself is stopped and started.
    printf 'relaunching the container\n'
    curl -sS -m 10 "http://$TV:8099/__tube/dev/relaunch" >/dev/null 2>&1 || true
    sleep 3
}

wait_for_page() {
    # Installing restarts the app on this platform, so the loop is: wait for the service to answer,
    # then wait for the page's own bridge. Without the second wait the next command races a page
    # that is still booting and reads the build that is on its way out.
    printf 'waiting for the app to come back'
    i=0
    while [ $i -lt 90 ]; do
        if curl -s -m 2 "http://$TV:8099/__tube/state" >/dev/null 2>&1; then break; fi
        printf '.'; i=$((i + 1)); sleep 1
    done
    i=0
    while [ $i -lt 90 ]; do
        if [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://$TV:8097/health" 2>/dev/null)" = "200" ]; then
            printf ' up\n'; return 0
        fi
        printf '.'; i=$((i + 1)); sleep 1
    done
    printf ' timed out\n'
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

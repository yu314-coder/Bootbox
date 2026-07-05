#!/bin/sh
# winetest — wine-staging 11.5 diagnostic matrix for the Bootbox QEMU-Wasm guest.
#
#   winetest            run the full matrix: cx16 probe -> esync -> plain
#   winetest cx16       engine atomic probe only (no wine)
#   winetest esync      WINEESYNC=1 winemine (eventfd sync — bypasses wineserver round-trips)
#   winetest plain      stock server-sync winemine
#   winetest nosvc      services.exe disabled (the old v1 workaround)
#   winetest logs       show the tails of all saved logs
#
# Every wine run: timeout-guarded, WINEDEBUG channels on, log -> /root/winetest-<mode>.log,
# success = a real X window appears (xwininfo), not just "process alive".

export DISPLAY=:0
export WINEPREFIX=/root/.wine WINEARCH=win64
ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

TMO=180          # seconds before we declare a hang
APP="winemine"   # built-in, pure win32, needs only user32/gdi32

ensure_x() {
    if ! xwininfo -root >/dev/null 2>&1; then
        echo "[winetest] X not up — starting Xvnc (same flags as xstart)..."
        (Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
              -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &)
        sleep 3
    fi
}

# wait_window <seconds> -> 0 if a WineMine window shows up in the X tree
wait_window() {
    w=0
    while [ "$w" -lt "$1" ]; do
        if xwininfo -root -tree 2>/dev/null | grep -qiE "mine|wine"; then return 0; fi
        sleep 5; w=$((w + 5))
        echo "  ... ${w}s (no window yet)"
    done
    return 1
}

run_mode() {
    mode="$1"; shift
    log="/root/winetest-$mode.log"
    echo ""
    echo "=== [$mode] $* $APP (timeout ${TMO}s, log $log) ==="
    ensure_x
    wineserver -k 2>/dev/null; sleep 2   # clean slate between modes
    WINEDEBUG="+timestamp,+tid,+loaddll,+process,+service${WTDBG_EXTRA}" \
        timeout "$TMO" env "$@" wine "$APP" >"$log" 2>&1 &
    wpid=$!
    if wait_window "$TMO"; then
        echo "[$mode] PASS — window is up! (wine works in this mode)"
        echo "[$mode] leaving $APP running so you can see it in the GUI tab"
        return 0
    fi
    echo "[$mode] FAIL — no window after ${TMO}s. Last log lines:"
    tail -n 12 "$log" 2>/dev/null | sed 's/^/    /'
    wineserver -k 2>/dev/null
    return 1
}

case "${1:-matrix}" in
cx16)
    /usr/local/bin/cx16test
    ;;
esync)
    WTDBG_EXTRA=",+esync" run_mode esync WINEESYNC=1
    ;;
plain)
    run_mode plain WINEESYNC=0
    ;;
nosvc)
    run_mode nosvc WINEESYNC=0 WINEDLLOVERRIDES="explorer.exe,services.exe=d"
    ;;
logs)
    for f in /root/winetest-*.log; do
        [ -f "$f" ] || continue
        echo "=== $f (last 15) ==="; tail -n 15 "$f"; echo ""
    done
    ;;
matrix | *)
    echo "wine: $(wine --version 2>/dev/null || echo MISSING)"
    echo ""
    echo "--- step 1/3: engine atomic probe (cx16) ---"
    /usr/local/bin/cx16test
    echo ""
    echo "--- step 2/3: wine + esync (the fix candidate) ---"
    if WTDBG_EXTRA=",+esync" run_mode esync WINEESYNC=1; then
        echo ""
        echo "RESULT: esync WORKS — wine is usable with WINEESYNC=1. Check the GUI tab!"
        exit 0
    fi
    echo ""
    echo "--- step 3/3: wine plain (server sync) ---"
    if run_mode plain WINEESYNC=0; then
        echo "RESULT: plain wine works (esync-specific failure — report logs)"
        exit 0
    fi
    echo ""
    echo "RESULT: wine still hangs in all modes. Run 'winetest logs' and check the cx16"
    echo "verdict above — if it says STOP-THE-WORLD, the fix is engine-side, not wine-side."
    ;;
esac

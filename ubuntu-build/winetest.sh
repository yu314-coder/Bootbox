#!/bin/sh
# winetest v3 — wine-staging 11.5 diagnostic matrix for the Bootbox QEMU-Wasm guest.
#
#   winetest            full matrix: cx16 probe -> cmd echo -> esync winemine
#   winetest cx16       engine atomic probe only (no wine)
#   winetest cmd        minimal full-stack test: wine cmd /c echo (no GUI — light!)
#   winetest esync      WINEESYNC=1 winemine, 600s window, wine KEEPS RUNNING at timeout
#   winetest plain      stock server-sync winemine (same patience)
#   winetest logs       tails of all saved logs
#   winetest kill       wineserver -k (stop everything wine)
#
# v3 lessons (on-device build 64): the engine fix works (cx16 penalty 2x, was
# stop-the-world) and wine RUNS — the old 180s timeout killed it while it was
# still loading DLLs (first run on a cold prefix builds font/registry caches,
# minutes under TCG). So: longer windows, a lightweight cmd stage first, no
# kill on timeout (check the GUI tab later — it may appear), and an explicit
# "esync active?" line so we know the fix candidate is actually engaged.

export DISPLAY=:0
export WINEPREFIX=/root/.wine WINEARCH=win64
ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

GUITMO=600       # seconds to wait for a window (wine keeps running afterwards)
CMDTMO=420       # seconds for the cmd/echo round trip
APP="winemine"

ensure_x() {
    if ! xwininfo -root >/dev/null 2>&1; then
        echo "[winetest] X not up — starting Xvnc (same flags as xstart)..."
        (Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
              -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &)
        sleep 3
    fi
}

esync_status() {
    # wine-staging prints "esync: up and running" (or "eventfd_synchronization") early with +esync
    if grep -qiE "esync: up and running|eventfd" "$1" 2>/dev/null; then
        echo "[winetest] esync ACTIVE in this run"
    else
        echo "[winetest] esync NOT seen in the log (plain server sync?)"
    fi
}

run_cmd_test() {
    log=/root/winetest-cmd.log
    echo ""
    echo "=== [cmd] WINEESYNC=1 wine cmd /c echo (no GUI — minimal full stack, ${CMDTMO}s) ==="
    echo "    first run on a cold boot can take minutes under the emulated CPU — be patient"
    WINEDEBUG="+timestamp,+tid,+esync" WINEESYNC=1 \
        timeout "$CMDTMO" wine cmd /c echo WINE-CMD-WORKS >"$log" 2>&1
    if grep -q "WINE-CMD-WORKS" "$log"; then
        echo "[cmd] PASS — wine executes programs! ($(grep -c . "$log") log lines)"
        esync_status "$log"
        return 0
    fi
    echo "[cmd] FAIL/timeout — last log lines:"
    tail -n 8 "$log" | sed 's/^/    /'
    esync_status "$log"
    return 1
}

run_gui() {
    mode="$1"; shift
    log="/root/winetest-$mode.log"
    echo ""
    echo "=== [$mode] $* $APP — up to ${GUITMO}s for a window; wine KEEPS RUNNING after ==="
    ensure_x
    WINEDEBUG="+timestamp,+tid,+loaddll,+esync" env "$@" wine "$APP" >"$log" 2>&1 &
    w=0
    while [ "$w" -lt "$GUITMO" ]; do
        if xwininfo -root -tree 2>/dev/null | grep -qiE "mine"; then
            echo "[$mode] PASS — window is up after ${w}s! Check the 🖥️ GUI tab."
            esync_status "$log"
            return 0
        fi
        sleep 10; w=$((w + 10))
        [ $((w % 60)) -eq 0 ] && echo "  ... ${w}s ($(grep -c loaddll "$log" 2>/dev/null) DLLs loaded so far)"
    done
    echo "[$mode] no window after ${GUITMO}s — wine is STILL RUNNING (not killed)."
    echo "    Check the 🖥️ GUI tab again in a few minutes, watch: tail /root/winetest-$mode.log"
    echo "    Stop everything with: winetest kill"
    tail -n 8 "$log" | sed 's/^/    /'
    esync_status "$log"
    return 1
}

case "${1:-matrix}" in
cx16)   /usr/local/bin/cx16test ;;
cmd)    run_cmd_test ;;
esync)  run_gui esync WINEESYNC=1 ;;
plain)  run_gui plain WINEESYNC=0 ;;
kill)   wineserver -k 2>/dev/null; echo "wineserver killed" ;;
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
    echo "--- step 2/3: minimal wine test (cmd echo, no GUI) ---"
    run_cmd_test || true
    echo ""
    echo "--- step 3/3: winemine + esync (GUI) ---"
    if run_gui esync WINEESYNC=1; then
        echo ""
        echo "RESULT: WINE WORKS with esync. Run your own .exe with: WINEESYNC=1 wine /path/to.exe"
        exit 0
    fi
    echo ""
    echo "RESULT: no window inside the wait — see above; it may still appear (GUI tab)."
    ;;
esac

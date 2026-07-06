#!/bin/sh
# winetest4 — STREAMING wine diagnostics. Pushed from the app into the guest via the
# 9p /share bridge at button-press time (no rootfs rebuild needed for updates).
# Every stage tails its own WINEDEBUG log into the console every 8s, so "wine is
# loading" is visible line-by-line instead of a silent multi-minute stall.
#
#   sh /share/winetest4.sh            full matrix: cx16 -> cmd -> winemine
#   sh /share/winetest4.sh cmd        console-only wine test (streams)
#   sh /share/winetest4.sh esync      winemine GUI test (streams)
#   sh /share/winetest4.sh cx16       engine probe only
#   sh /share/winetest4.sh logs|kill  tails / wineserver -k

export DISPLAY=:0 WINEPREFIX=/root/.wine WINEARCH=win64
ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

# stream_wait <log> <timeout-s> <pass-grep|-> <window-grep|->
# Prints NEW log lines every 8s (up to 8 per tick, trimmed to 110 cols).
stream_wait() {
    log="$1"; tmo="$2"; okpat="$3"; winpat="$4"
    last=0; t=0
    while [ "$t" -lt "$tmo" ]; do
        sleep 8; t=$((t + 8))
        total=$(wc -l < "$log" 2>/dev/null || echo 0)
        if [ "$total" -gt "$last" ]; then
            echo "--- +${t}s · log ${last}->${total} lines ---"
            tail -n +"$((last + 1))" "$log" | head -n 8 | cut -c1-110
            last=$total
        else
            echo "... +${t}s (no new wine output)"
        fi
        if [ "$okpat" != "-" ] && grep -q "$okpat" "$log" 2>/dev/null; then return 0; fi
        if [ "$winpat" != "-" ] && xwininfo -root -tree 2>/dev/null | grep -qi "$winpat"; then return 0; fi
    done
    return 1
}

cmd_test() {
    log=/root/winetest-cmd.log; : > "$log"
    echo "=== wine cmd /c echo — console only, streams live, up to 420s ==="
    (WINEDEBUG="+timestamp,+tid,+loaddll,+process" WINEESYNC=1 \
        timeout 420 wine cmd /c echo WINE-CMD-WORKS >>"$log" 2>&1; echo "WINE-CMD-EXIT=$?" >>"$log") &
    if stream_wait "$log" 430 "WINE-CMD-WORKS" "-"; then
        echo "[cmd] PASS — wine executes programs."
        return 0
    fi
    echo "[cmd] no PASS marker — last lines:"; tail -n 6 "$log" | cut -c1-110
    return 1
}

gui_test() {
    log=/root/winetest-esync.log; : > "$log"
    echo "=== winemine + esync — streams live, up to 600s; wine KEEPS RUNNING after ==="
    if ! xwininfo -root >/dev/null 2>&1; then
        echo "[gui] starting Xvnc..."
        (Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
              -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &)
        sleep 3
    fi
    (WINEDEBUG="+timestamp,+tid,+loaddll,+esync" WINEESYNC=1 wine winemine >>"$log" 2>&1 &)
    if stream_wait "$log" 600 "-" "mine"; then
        echo "[gui] PASS — window is up. Check the 🖥️ GUI tab!"
        grep -qiE "esync: up and running|eventfd" "$log" && echo "[gui] esync ACTIVE" || echo "[gui] esync not seen in log"
        return 0
    fi
    echo "[gui] no window inside the wait — wine is STILL RUNNING (sh /share/winetest4.sh kill to stop)."
    tail -n 6 "$log" | cut -c1-110
    return 1
}

case "${1:-matrix}" in
cx16)  cx16test ;;
cmd)   cmd_test ;;
esync) gui_test ;;
kill)  wineserver -k 2>/dev/null; echo "wineserver killed" ;;
logs)  for f in /root/winetest-*.log; do [ -f "$f" ] || continue; echo "== $f =="; tail -n 12 "$f" | cut -c1-110; echo; done ;;
*)
    echo "wine: $(wine --version 2>/dev/null || echo MISSING)"
    echo ""
    echo "--- step 1/3: engine atomic probe ---"
    cx16test
    echo ""
    echo "--- step 2/3: wine console test (streams) ---"
    cmd_test || true
    echo ""
    echo "--- step 3/3: winemine GUI test (streams) ---"
    if gui_test; then
        echo ""
        echo "RESULT: WINE WORKS — run your own: WINEESYNC=1 wine /share/yourapp.exe"
    fi
    ;;
esac

#!/bin/sh
# Bootbox DESKTOP guest v4 (build 75) — a modern lightweight desktop:
#   • Openbox window manager (opaque drag + real borders — replaces the ancient twm wireframe)
#   • PCManFM --desktop = THE wallpaper + single-tap app icons (Dillo/Files/Claude/Terminal/Python)
#   • tint2 panel (taskbar + clock)
#   • xterm uses DejaVu Sans Mono (Xft) + UTF-8, so Claude Code's TUI renders cleanly
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export ENV=/etc/ashrc
if [ ! -e /tmp/.xstarted ]; then
  : > /tmp/.xstarted
  (
    Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
         -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &
    n=0; while [ "$n" -lt 80 ] && [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.25; n=$((n+1)); done
    export DISPLAY=:0
    export HOME=/root
    # Instant pre-paint in the wallpaper's base color so there's no black flash before pcmanfm
    # paints the real wallpaper + icons (ONE desktop, no more gradient→icons visual jump).
    xsetroot -solid '#0a1220' 2>/dev/null
    openbox >/tmp/openbox.log 2>&1 &
    sleep 1
    # PCManFM desktop mode IS the wallpaper + the single-tap app icons.
    pcmanfm --desktop >/tmp/pcmanfm-desktop.log 2>&1 &
    tint2 >/tmp/tint2.log 2>&1 &
    # One terminal open on start (box-drawing font + login shell so `help` works).
    bxterm -ls -bg rgb:0b/0f/17 -fg rgb:b7/f5/cf -geometry 82x24+40+40 -title "Terminal" >/tmp/xterm.log 2>&1 &
  ) &
fi
export DISPLAY=:0
export HOME=/root
exec /bin/sh -l

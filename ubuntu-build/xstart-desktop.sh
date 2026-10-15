#!/bin/sh
# Bootbox DESKTOP guest v8 — openbox + tint2.
#   * openbox: flat dark "Bootbox" theme, smart+centred placement (twm asked you to click to place
#     every new window - the "grid of lines" the old desktop showed), proper title-bar buttons,
#     drag to move/resize, double-click to maximise, right-click the desktop for the app menu.
#     (openbox once painted black here; that was the engine - stack overflow/POPCNT bugs, since
#     fixed - and it is verified to render on the current engine.) twm stays as a fallback.
#   * tint2 panel: Apps button (opens the menu), pinned apps, window list, clock.
#   * wallpaper via xwallpaper (no resident desktop process).
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export ENV=/etc/ashrc
if [ ! -e /tmp/.xstarted ]; then
  : > /tmp/.xstarted
  (
    Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
         -desktop bootbox -AlwaysShared -DeferUpdate 10 >/tmp/xvnc.log 2>&1 &
    n=0; while [ "$n" -lt 80 ] && [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.25; n=$((n+1)); done
    export DISPLAY=:0
    export HOME=/root
    xsetroot -solid '#0b111c' -cursor_name left_ptr 2>/dev/null
    xwallpaper --zoom /usr/share/bootbox-wallpaper.png 2>/dev/null
    openbox >/tmp/openbox.log 2>&1 &
    ob=$!
    sleep 3
    if ! kill -0 "$ob" 2>/dev/null; then twm >/tmp/twm.log 2>&1 & fi   # fallback window manager
    tint2 >/tmp/tint2.log 2>&1 &
    bxterm -geometry 82x22+120+90 >/tmp/xterm.log 2>&1 &
  ) &
fi
export DISPLAY=:0
export HOME=/root
exec /bin/sh -l

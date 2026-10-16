#!/bin/sh
# Bootbox DESKTOP guest v8+ (v12) — openbox + tint2 + conky widget, browser pre-started.
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
# v10: terminals run bash; WebKit paints in software (no GL/DMA-BUF probing - Mesa under emulation is
# far slower) and GTK apps skip the accessibility bus they would otherwise wait for.
export SHELL=/bin/bash
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 NO_AT_BRIDGE=1
if [ ! -e /tmp/.xstarted ]; then
  : > /tmp/.xstarted
  (
    Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
         -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &
    n=0; while [ "$n" -lt 80 ] && [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.25; n=$((n+1)); done
    export DISPLAY=:0
    export HOME=/root
    xsetroot -solid '#0b111c' -cursor_name left_ptr 2>/dev/null
    xwallpaper --zoom /usr/share/bootbox-wallpaper.png 2>/dev/null
    openbox >/tmp/openbox.log 2>&1 &
    ob=$!
    # Start the panel and terminal only once openbox is really managing (its "Openbox" check window
    # exists). Started during openbox's slow startup on the emulated CPU they could stay unmapped
    # forever - desktop v9 showed only the wallpaper. Fall back to twm if openbox dies.
    n=0
    while [ "$n" -lt 240 ] && ! xwininfo -root -children 2>/dev/null | grep -q '"Openbox"'; do
      kill -0 "$ob" 2>/dev/null || break
      sleep 0.5; n=$((n+1))
    done
    if ! kill -0 "$ob" 2>/dev/null; then twm >/tmp/twm.log 2>&1 & fi   # fallback window manager
    tint2 >/tmp/tint2.log 2>&1 &
    bxterm -geometry 82x22+120+90 >/tmp/xterm.log 2>&1 &
    # v12: per-core CPU / memory widget (top right) - a few seconds later, so its start-up doesn't
    # race the terminal above (bash then drew its first prompt one character per line) - and the
    # browser pre-started hidden once the desktop has settled, so the first Web tap opens it at once
    # (WebKit takes ~20-50 s to start on the emulated CPU). Normal priority: the guest container
    # can't raise a nice'd process back, which left the pre-started browser slow for good.
    ( sleep 6; bootbox-conky >/tmp/conky.log 2>&1 ) &
    ( sleep 120; bbweb --prewarm >/tmp/bbweb-prewarm.log 2>&1 ) &
    # Self-heal: if the panel still isn't on screen after 2 minutes, start it again.
    (
      sleep 120
      w=$(xwininfo -root -tree 2>/dev/null | grep '"tint2"' | head -1 | awk '{print $1}')
      if [ -z "$w" ] || ! xwininfo -id "$w" 2>/dev/null | grep -q IsViewable; then
        pkill -x tint2; sleep 1; tint2 >>/tmp/tint2.log 2>&1 &
      fi
    ) &
  ) &
fi
export DISPLAY=:0
export HOME=/root
exec /bin/sh -l

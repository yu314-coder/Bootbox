#!/bin/sh
# Bootbox DESKTOP guest v6 (build 76) — lightweight desktop that ACTUALLY RENDERS:
#   • twm window manager WITH OpaqueMove (drags the real window, not the old ugly wireframe).
#     openbox (v5) left the Xvnc root BLACK on-device under TCG — the process stayed alive but
#     nothing painted (same flood-Xvnc failure as jwm/fluxbox). twm is the only WM proven to
#     render on this stack (v2/v3/v4). OpaqueMove is the fix for the "dragging is bad/old" gripe.
#   • PCManFM --desktop = wallpaper + single-tap app icons
#   • tint2 panel · bxterm terminal (fixed font + login shell so `help` works)
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export ENV=/etc/ashrc
if [ ! -e /tmp/.xstarted ]; then
  : > /tmp/.xstarted

  cat > /root/.twmrc <<'TWMRC'
NoGrabServer
RestartPreviousState
OpaqueMove
OpaqueResize
NoRaiseOnMove
TitleFont "fixed"
MenuFont "fixed"
IconFont "fixed"
ResizeFont "fixed"
BorderWidth 2
# Don't decorate the panel / desktop with a title bar (the "Tint2 panel" stray window was twm
# framing tint2 as a normal window). Leave the pcmanfm desktop window undecorated too.
NoTitle {
  "tint2"
  "pcmanfm"
}
NoHighlight { "tint2" "pcmanfm" }
Color {
  BorderColor "#2f6bdb"
  DefaultBackground "#16263f"
  DefaultForeground "#dfe8f5"
  TitleBackground "#2f6bdb"
  TitleForeground "#ffffff"
  MenuBackground "#16263f"
  MenuForeground "#dfe8f5"
  MenuTitleBackground "#2f6bdb"
  MenuTitleForeground "#ffffff"
}
Button3 = : root : f.menu "apps"
menu "apps" {
  "Bootbox Linux Desktop"  f.title
  "Web browser (Dillo)"    !"dillo http://example.com >/tmp/dillo.log 2>&1 &"
  "Files (PCManFM)"        !"pcmanfm >/tmp/pcmanfm.log 2>&1 &"
  "Claude Code"            !"bxterm -bg rgb:0d/15/26 -fg rgb:cd/e6/ff -geometry 100x32 -title Claude -e sh -lc claude &"
  "Terminal"               !"bxterm -ls -bg rgb:0b/0f/17 -fg rgb:b7/f5/cf &"
  "Python REPL"            !"bxterm -e python3 &"
  ""                       f.nop
  "Restart desktop"        f.restart
  "Close a window"         f.delete
}
TWMRC

  (
    Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
         -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &
    n=0; while [ "$n" -lt 80 ] && [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.25; n=$((n+1)); done
    export DISPLAY=:0
    export HOME=/root
    # Base color pre-paint (pcmanfm paints the real wallpaper + icons over it).
    xsetroot -solid '#0a1220' 2>/dev/null
    twm >/tmp/twm.log 2>&1 &
    sleep 1
    pcmanfm --desktop >/tmp/pcmanfm-desktop.log 2>&1 &
    tint2 >/tmp/tint2.log 2>&1 &
    bxterm -ls -bg rgb:0b/0f/17 -fg rgb:b7/f5/cf -geometry 82x24+40+40 -title "Terminal" >/tmp/xterm.log 2>&1 &
  ) &
fi
export DISPLAY=:0
export HOME=/root
exec /bin/sh -l

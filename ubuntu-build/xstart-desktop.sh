#!/bin/sh
# Bootbox DESKTOP guest — a lightweight graphical desktop (no web browser; they freeze Xvnc under TCG).
#   • twm window manager + right-click app menu (Terminal / Files / Python)
#   • tint2 panel (taskbar + clock)
#   • a Terminal and the mc (Midnight Commander) file manager open on start
# mc is a TUI inside a terminal, so it never floods X — it works fine under emulation.
if [ ! -e /tmp/.xstarted ]; then
  : > /tmp/.xstarted

  cat > /root/.twmrc <<'TWMRC'
NoGrabServer
RestartPreviousState
DecorateTransients
TitleFont "fixed"
MenuFont "fixed"
IconFont "fixed"
ResizeFont "fixed"
BorderWidth 2
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
  "Web browser (links)"    !"xterm -fn fixed -bg black -fg white -geometry 96x30 -title Browser -e links http://example.com &"
  "Terminal"               !"xterm -fn fixed -bg black -fg green -sb &"
  "Files (mc)"             !"xterm -fn fixed -bg black -fg white -e mc &"
  "Python REPL"            !"xterm -fn fixed -bg black -fg white -e python3 &"
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
    xsetroot -solid '#1f3350' 2>/dev/null
    # A terminal + the mc file manager, pre-opened (tap the tint2 taskbar to switch).
    xterm -fn fixed -bg black -fg green -geometry 78x22+30+24 -title "Terminal" -sb >/tmp/xterm.log 2>&1 &
    xterm -fn fixed -bg black -fg white -geometry 78x22+360+300 -title "Files (mc)" -e mc >/tmp/mc.log 2>&1 &
    sleep 1
    twm >/tmp/twm.log 2>&1 &
    sleep 1
    tint2 >/tmp/tint2.log 2>&1 &
  ) &
fi
export DISPLAY=:0
export HOME=/root
exec /bin/sh -l

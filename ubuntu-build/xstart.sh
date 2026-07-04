#!/bin/sh
# Bootbox 64-bit Linux X server — BARE by default (Xvnc + twm only).
#
# Xvnc (tigervnc) = the X server AND VNC server in one process (x11vnc blocked on XGetImage under the
# qemu-wasm TCG CPU). Listens on :0 / port 5900; the in-app netstack vn.Dials it and bridges RFB to
# noVNC. twm is the window manager (jwm/fluxbox HANG the single-threaded Xvnc under TCG — they flood it
# so the screen stays black; twm is minimal and safe). Right-click the root for an app menu.
#
# This starts ONLY Xvnc + twm, so the X root is BLANK (no panel, no terminal, no wallpaper) until you
# launch a graphical program. The plain "64-bit + Python & Wine" guest uses this as-is: its right-hand
# GUI stays empty until you run an X program from the terminal (DISPLAY is exported into the serial
# shell below, so `xeyes &` / a Wine GUI just appears). The "64-bit — Desktop" guest gets the full
# desktop chrome (wallpaper + terminal + tint2 taskbar) from `start-desktop`, which the app runs over
# the serial console right after boot — only for that guest.
#
# The serial console stays the LEFT-pane terminal: this script ends by exec-ing a login shell.
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
  "Bootbox 64-bit Linux"  f.title
  "Terminal"              !"xterm -fn fixed -bg black -fg green -sb &"
  "Python REPL"           !"xterm -fn fixed -bg black -fg white -e python3 &"
  ""                      f.nop
  "Restart desktop"       f.restart
  "Close a window"        f.delete
}
TWMRC
  (
    Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
         -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &
    n=0; while [ "$n" -lt 80 ] && [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.25; n=$((n+1)); done
    export DISPLAY=:0
    export HOME=/root
    twm >/tmp/twm.log 2>&1 &                    # minimal WM only — BLANK root until a program opens
  ) &                                           # (the Desktop guest adds wallpaper/term/panel via start-desktop)
fi
export DISPLAY=:0    # so X programs launched from this serial shell appear on the right-hand GUI
export HOME=/root
exec /bin/sh -l

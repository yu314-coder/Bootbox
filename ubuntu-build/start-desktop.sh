#!/bin/sh
# Bootbox — start the full graphical desktop chrome on the already-running X display.
#
# xstart brings up a BARE X (Xvnc + twm). For the "64-bit Linux — Desktop" boot option, the app runs
# this script over the serial console right after boot to turn that blank X into a real desktop:
# a solid wallpaper, a terminal window, and the tint2 taskbar/clock. The plain 64-bit guest never runs
# this, so its GUI stays blank until the user launches a program.
export DISPLAY=:0
export HOME=/root
# wait for the X server (Xvnc) to be listening
n=0; while [ "$n" -lt 80 ] && [ ! -e /tmp/.X11-unix/X0 ]; do sleep 0.25; n=$((n+1)); done
# already started? (idempotent — the app may send this more than once)
if [ -e /tmp/.desktop-started ]; then exit 0; fi
: > /tmp/.desktop-started
xsetroot -solid '#1f3350' 2>/dev/null                                            # wallpaper colour
xterm -fn fixed -bg black -fg green -geometry 92x26+60+40 -title "Terminal" -sb >/tmp/xterm.log 2>&1 &
[ -x /usr/bin/tint2 ] && tint2 >/tmp/tint2.log 2>&1 &                             # bottom taskbar + clock
exit 0

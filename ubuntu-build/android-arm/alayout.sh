#!/bin/sh
P=127.0.0.1:6558; A="adb -s $P"
$A root >/dev/null 2>&1; sleep 4; adb connect $P >/dev/null; sleep 2
sleep 40; $A shell "input keyevent KEYCODE_HOME"; sleep 40
$A shell "dumpsys user | grep -m1 State; cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -1; ls /data/user/0/app.lawnchair/databases/"
$A push /tmp/dock.sql /data/local/tmp/dock.sql >/dev/null; $A push /tmp/dock2.sql /data/local/tmp/dock2.sql >/dev/null
$A shell "am force-stop app.lawnchair; sqlite3 /data/user/0/app.lawnchair/databases/launcher_5_4_4.db < /data/local/tmp/dock.sql; sqlite3 /data/user/0/app.lawnchair/databases/launcher_5_4_4.db < /data/local/tmp/dock2.sql; sqlite3 /data/user/0/app.lawnchair/databases/launcher_5_4_4.db 'select title,container,screen,cellX,cellY from favorites'; input keyevent KEYCODE_HOME"
sleep 30; $A exec-out screencap -p > /tmp/arm2.png; echo layout-done

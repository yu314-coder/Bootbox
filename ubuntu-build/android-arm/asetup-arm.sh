#!/bin/sh
# asetup-arm.sh (in qemub, ARM Android booted on :6558): Lawnchair home + layout, gesture nav, wallpaper -> userdata-lawn
P=127.0.0.1:6558; A="adb -s $P"
$A root >/dev/null 2>&1; sleep 4; adb connect $P >/dev/null; sleep 2
$A install -r /tmp/lawnchair.apk | tail -1
$A push /tmp/wall.jpg /data/local/tmp/wall.jpg >/dev/null
$A shell "cmd package set-home-activity --user 0 app.lawnchair/.LawnchairLauncher; cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural; \
  settings put global window_animation_scale 0.5; settings put global transition_animation_scale 0.5; settings put global animator_duration_scale 0.5; \
  pm disable com.android.keychain; \
  for f in wallpaper wallpaper_orig; do cp /data/local/tmp/wall.jpg /data/system/users/0/\$f; chown system:system /data/system/users/0/\$f; chmod 600 /data/system/users/0/\$f; done; \
  rm -f /data/system/users/0/wallpaper_info.xml; stop; sleep 2; start"
sleep 30
for i in $(seq 1 100); do adb connect $P >/dev/null 2>&1; b=$(timeout 8 $A shell getprop sys.boot_completed 2>/dev/null | tr -d "\r"); [ "$b" = 1 ] && break; sleep 6; done
sleep 30; $A shell "input keyevent KEYCODE_HOME"; sleep 40
$A shell "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -1; ls /data/user/0/app.lawnchair/databases/"
$A push /tmp/dock.sql /data/local/tmp/dock.sql >/dev/null; $A push /tmp/dock2.sql /data/local/tmp/dock2.sql >/dev/null
$A shell "am force-stop app.lawnchair; sqlite3 /data/user/0/app.lawnchair/databases/launcher_5_4_4.db < /data/local/tmp/dock.sql; sqlite3 /data/user/0/app.lawnchair/databases/launcher_5_4_4.db < /data/local/tmp/dock2.sql; \
  sqlite3 /data/user/0/app.lawnchair/databases/launcher_5_4_4.db 'select title,container,screen,cellX,cellY from favorites'; input keyevent KEYCODE_HOME"
sleep 30; echo setup-done

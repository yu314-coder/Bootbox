#!/bin/sh
# aprep.sh : make the booted Android snapshot-ready (run inside qemub after boot_completed)
A="adb -s 127.0.0.1:6555"
$A root >/dev/null 2>&1; sleep 4; adb connect 127.0.0.1:6555 >/dev/null; sleep 2
$A shell "settings put secure immersive_mode_confirmations confirmed; settings put global stay_on_while_plugged_in 7; \
  settings put system screen_off_timeout 2147483647; locksettings set-disabled true; settings put global hide_error_dialogs 1; \
  settings put global window_animation_scale 0.5; settings put global transition_animation_scale 0.5; \
  settings put global animator_duration_scale 0.5; pm disable-user com.android.traceur >/dev/null 2>&1; \
  pm disable-user com.android.printspooler >/dev/null 2>&1; setprop ctl.stop vendor.bluetooth-1-1; \
  setprop dalvik.vm.dex2oat64.enabled true; \
  pm disable com.android.keychain; dumpsys battery set ac 1; dumpsys battery set level 100"
# (Not done: disabling the Bluetooth app - `pm disable com.android.bluetooth` restarts system_server and
#  made every app launch 2x slower in the snapshot, Nov 14.)
# (KeyChain crashes here: no AndroidKeyStore provider -> SystemUI's SysUiBg waited on its bind forever
#  and every quick-settings tile stayed blank. Disabled, the bind fails at once. Battery: the VM has none,
#  healthd says 0% -> Lawnchair's At a Glance showed "Battery low".)
for p in app.lawnchair com.android.systemui com.android.settings com.android.contacts com.android.deskclock \
         com.android.gallery3d com.android.documentsui com.android.calendar org.chromium.webview_shell; do
  $A shell "cmd package compile -m speed -f $p" | tail -1
done
# compiled code takes effect in new processes: restart the apps, then open each once (warm caches)
# SystemUI is KILLED, not force-stopped: a force-stop of the wallpaper's package makes WallpaperManagerService
# clear the wallpaper (v8 first take came up on the AOSP default). The original wallpaper is re-installed first.
adb -s 127.0.0.1:6555 push /tmp/wall.jpg /data/local/tmp/wall.jpg >/dev/null
$A shell "settings put secure sysui_qs_tiles internet,bt,flashlight,dnd,alarm,airplane,controls,wallet,rotation,battery,cast,screenrecord,mictoggle,cameratoggle; \
  for f in wallpaper wallpaper_orig; do cp /data/local/tmp/wall.jpg /data/system/users/0/\$f; chown system:system /data/system/users/0/\$f; chmod 600 /data/system/users/0/\$f; done; \
  am force-stop app.lawnchair; pkill -f com.android.systemui" ; sleep 30
for c in com.android.settings/.Settings com.android.deskclock/.DeskClock com.android.contacts/.activities.PeopleActivity \
         com.android.documentsui/.LauncherActivity com.android.calendar/.AllInOneActivity; do
  $A shell "am start -W -n $c" | grep -E "TotalTime"; sleep 3; $A shell "input keyevent KEYCODE_HOME"; sleep 3
done
# Lawnchair At a Glance: date only (the VM has no battery; Now Playing needs notification dots)
$A shell "cmd notification allow_listener app.lawnchair/com.android.launcher3.notification.NotificationListener; am start -n app.lawnchair/.ui.preferences.PreferenceActivity >/dev/null"
sleep 10; $A shell "input tap 160 222"; sleep 6; $A shell "input tap 352 328"; sleep 3
$A shell "input tap 754 461"; sleep 3; $A shell "input tap 754 506"; sleep 3
$A shell "service call SurfaceFlinger 1008 i32 1 >/dev/null; input keyevent KEYCODE_HOME"
sleep 20
# finish the background compilation now (otherwise dex2oat runs "post-boot" right after every resume)
$A shell "cmd package bg-dexopt-job" | tail -1
# warm the everyday UI paths (their Skia programs and caches go into the snapshot): app drawer, shade, recents
for i in 1 2; do
  $A shell "input swipe 400 450 400 120 250"; sleep 8; $A shell "input swipe 400 150 400 560 250"; sleep 8
  $A shell "input swipe 400 2 400 400 250"; sleep 8; $A shell "cmd statusbar expand-settings"; sleep 8
  $A shell "input swipe 400 500 400 50 250"; sleep 6
  $A shell "input keyevent KEYCODE_APP_SWITCH"; sleep 10; $A shell "input keyevent KEYCODE_HOME"; sleep 8
done
$A shell "cmd statusbar collapse; input keyevent KEYCODE_HOME; stop llkd-0; stop llkd-1"
sleep 10
echo "composition: $($A shell dumpsys SurfaceFlinger | grep -o 'usesClientComposition=[a-z]*' | head -1)"
echo "wallpaper: $($A shell ls -la /data/system/users/0/wallpaper 2>&1 | cut -c1-60)"

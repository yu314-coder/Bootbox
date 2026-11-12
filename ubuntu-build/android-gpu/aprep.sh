#!/bin/sh
# aprep.sh : make the booted Android snapshot-ready (run inside qemub after boot_completed)
A="adb -s 127.0.0.1:6555"
$A root >/dev/null 2>&1; sleep 4; adb connect 127.0.0.1:6555 >/dev/null; sleep 2
$A shell "settings put secure immersive_mode_confirmations confirmed; settings put global stay_on_while_plugged_in 7; \
  settings put system screen_off_timeout 2147483647; locksettings set-disabled true; settings put global hide_error_dialogs 1; \
  settings put global window_animation_scale 0.5; settings put global transition_animation_scale 0.5; \
  settings put global animator_duration_scale 0.5; pm disable-user com.android.traceur >/dev/null 2>&1; \
  pm disable-user com.android.printspooler >/dev/null 2>&1; setprop ctl.stop vendor.bluetooth-1-1; \
  setprop dalvik.vm.dex2oat64.enabled true"
for p in app.lawnchair com.android.systemui com.android.settings com.android.contacts com.android.deskclock \
         com.android.gallery3d com.android.documentsui com.android.calendar org.chromium.webview_shell; do
  $A shell "cmd package compile -m speed -f $p" | tail -1
done
# compiled code takes effect in new processes: restart the apps, then open each once (warm caches)
$A shell "am force-stop app.lawnchair; am force-stop com.android.systemui" ; sleep 30
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
echo "composition: $($A shell dumpsys SurfaceFlinger | grep -o 'usesClientComposition=[a-z]*' | head -1)"

#!/bin/sh
# cpuztest - run the REAL CPU-Z Windows benchmark under Wine, headless, and print the score.
# Pushed into the guest via the 9p /share bridge at button-press (no rootfs rebuild). CPU-Z's
# -bench flag runs the benchmark with NO GUI and writes a .txt result named after the machine.
#   sh /share/cpuztest.sh 64   -> 64-bit CPU-Z benchmark
#   sh /share/cpuztest.sh 32   -> 32-bit CPU-Z benchmark
#   sh /share/cpuztest.sh info -> CPU-Z register/CPU report (-txt, no benchmark)
# LIBGL_ALWAYS_SOFTWARE + the driver-off cpuz.ini are BOTH load-bearing: without them CPU-Z hangs
# trying to init the (nonexistent) GPU/mesa DRI under wine. Verified: with them, -bench completes.
export WINEPREFIX=/root/.wine WINEARCH=win64 WINEESYNC=1 WINEDEBUG=-all DISPLAY=:0 LIBGL_ALWAYS_SOFTWARE=1
# The guest rootfs is unpacked fresh every boot, so Wine's prefix-vs-install timestamp check always
# fails and the first Wine launch of each boot re-runs `wineboot --init` + winemenubuilder: minutes
# of full-CPU work that also competed with the benchmark threads. The prefix was warmed by this same
# Wine build, so it is current; "disable" is Wine's documented switch to skip the auto-update.
echo disable > "$WINEPREFIX/.update-timestamp" 2>/dev/null
export WINEDLLOVERRIDES="winemenubuilder.exe=d"
BASE=https://github.com/yu314-coder/Bootbox/releases/download/cpuz-v1
DIR=/root/cpuz; mkdir -p "$DIR"; cd "$DIR" || exit 1

# CPU-Z may still init wine's display layer even in -bench mode -> make sure an X server exists.
# Probe with a timeout: a wedged Xvnc never answers, and an un-timed xwininfo would hang here.
if ! timeout 15 xwininfo -root >/dev/null 2>&1; then
  pkill -x Xvnc 2>/dev/null && sleep 2; pkill -9 -x Xvnc 2>/dev/null
  (Xvnc :0 -geometry 1024x768 -depth 16 -SecurityTypes None -rfbport 5900 -localhost no \
        -desktop bootbox -AlwaysShared >/tmp/xvnc.log 2>&1 &); sleep 6
fi

# Download CPU-Z (once) from the Bootbox release.
for f in cpuz_x64.exe cpuz_x32.exe cpuz.ini; do
  if [ ! -s "$f" ]; then
    echo "downloading $f (one-time)..."
    wget -q -T 60 -O "$f" "$BASE/$f" || { echo "download failed: $f (check internet)"; exit 1; }
  fi
done
echo "CPU-Z files ready ($(du -sh . | cut -f1))."

MODE="${1:-64}"
case "$MODE" in
info)
  EXE=cpuz_x64.exe
  echo "=== CPU-Z report (-txt, no benchmark) ==="
  rm -f report.txt
  timeout 300 wine "$EXE" -txt=report 2>/dev/null
  [ -f report.txt ] && grep -iE "Name|Codename|Specification|Cores|Threads|Instructions|Stock freq" report.txt | head -20 || echo "no report - wine may have failed"
  ;;
*)
  EXE=cpuz_x64.exe; [ "$MODE" = "32" ] && EXE=cpuz_x32.exe
  echo "=== CPU-Z ${MODE}-bit BENCHMARK (real Windows app, under Wine, headless) ==="
  echo "every x86 instruction is translated to WebAssembly in software, so this takes ~5 MINUTES."
  echo "single- and multi-thread scores appear below when it finishes:"
  rm -f ./*.txt
  timeout 900 wine "$EXE" -bench 2>/dev/null
  R=$(ls -t ./*.txt 2>/dev/null | head -1)
  if [ -n "$R" ]; then
    SC=$(cat "$R")
    ST=$(echo "$SC" | cut -d',' -f1 | tr -d '"')
    MT=$(echo "$SC" | cut -d',' -f2 | tr -d '"')
    echo ""
    echo "=========== CPU-Z $MODE-bit BENCHMARK ==========="
    echo "  Single-thread score : ${ST:-?}"
    echo "  Multi-thread  score : ${MT:-?}"
    echo "  (raw: $SC)"
    echo "================================================="
    echo "These are tiny vs a native CPU (hundreds per core): every guest instruction is emulated"
    echo "in software, and CPU-Z's bench is scalar SSE floating point, which runs through QEMU's"
    echo "softfloat helpers -- roughly 1000x native here, vs ~100-200x for general integer code."
    echo "Multi-thread / single-thread = how many emulated cores really ran in parallel."
  else
    echo "no result .txt produced. Wine may not have completed the benchmark under emulation."
    echo "Try the GUI instead:  WINEESYNC=1 wine /root/cpuz/$EXE   (then Bench tab -> Bench CPU)"
  fi
  ;;
esac

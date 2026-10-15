#!/bin/sh
# bootbox-help - the real `help` for the Bootbox desktop guest (aliased over the shell builtin).
# PURE ASCII only: the terminal's bitmap X font has no glyphs for em-dash / bullet / emoji, so any
# non-ASCII char renders as garbage in the terminal. Keep this file 7-bit ASCII.
cat <<'TXT'

  BOOTBOX LINUX - commands & apps
  ===============================
  GRAPHICAL APPS (open on the desktop)
    web [url|words]   web browser (full JavaScript; tabs; Ctrl+L address, Ctrl+T tab)
    dillo [url]       lite web browser (very fast, no JavaScript)
    pcmanfm           file manager
    bxterm            another terminal window

  TERMINAL (bash: Tab completes, Up/Down search history)
    python3  pip install X      Python 3.12 (pip is fast, via uv)
    htop                        processes / CPU / memory
    ncdu  tree  du -sh *        disk usage
    nano FILE  vim FILE         text editors
    mc                          file manager (text UI)
    tmux                        split the terminal / keep sessions
    git  curl  wget  rg  jq     the usual tools      fastfetch   system info
    ssh  rsync  zip/unzip  sqlite3  bc
    apk add NAME                install any Alpine package (apk search NAME)

  BENCHMARKS (Apps menu)
    cpuz-bench        CPU-Z (Windows) under Wine
    gpu-bench         glmark2 on the software GPU

  FILES
    /share            folder shared with the iPad Files app

  TIPS
    - tap Apps (bottom left) or right-click the wallpaper for the app menu
    - the iPad pointer IS the mouse: tap = click, two-finger tap = right-click
    - type 'help' to show this again
TXT

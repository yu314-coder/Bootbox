#!/bin/sh
# bootbox-help - the real `help` for the Bootbox desktop guest (aliased over the shell builtin).
# PURE ASCII only: the terminal's bitmap X font has no glyphs for em-dash / bullet / emoji, so any
# non-ASCII char renders as garbage in the terminal. Keep this file 7-bit ASCII.
cat <<'TXT'

  BOOTBOX LINUX - commands & apps
  ===============================
  GRAPHICAL APPS (Apps menu, bottom left; grouped in submenus)
    web [url|words]   web browser (full JavaScript, tabs; Lite button = fast mobile pages)
    dillo [url]       lite web browser (very fast, no JavaScript)
    mousepad          text editor          galculator   calculator
    gpicview          image viewer         xarchiver    archive manager
    pcmanfm           file manager         bxterm       another terminal

  TERMINAL (bash: Tab completes, Up/Down search history)
    python3  pip install X      Python 3.12 (pip is fast, via uv)
    htop  fastfetch             processes / system info
    ncdu  tree  du -sh *        disk usage
    nano FILE  vim FILE         text editors
    mc  tmux                    file manager (text) / split terminal
    git  curl  wget  rg  jq     the usual tools
    7zz  ssh  rsync  zip/unzip  sqlite3  bc
    apk add NAME                install any Alpine package (apk search NAME)

  BENCHMARKS (Apps > Benchmarks, or the Benchmarks icon: one page, all results)
    cpuz-bench        CPU-Z (Windows) under Wine, single + multi core
    7z-bench          7-Zip compression rating, single + multi core
    sysbench-bench    sysbench CPU, 10 s single + 10 s multi (quickest)
    gpu-bench         glmark2 on the software GPU
    web bootbox://app/webbench  the browser's JavaScript / DOM / canvas speed

  FILES
    /share            folder shared with the iPad Files app

  TIPS
    - tap Apps (bottom left) or right-click the wallpaper for the app menu
    - the box top right shows each emulated CPU core's load live
    - the iPad pointer IS the mouse: tap = click, two-finger tap = right-click
    - web: ads and trackers are blocked (much less JavaScript to run here);
      to allow them: mkdir -p ~/.config/bbweb; touch ~/.config/bbweb/noblock
      and restart the browser: pkill bbweb-engine
    - web: Lite (toolbar) = mobile sites, no pictures - the fastest pages
    - type 'help' to show this again
TXT

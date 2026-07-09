#!/bin/sh
# bootbox-help - the real `help` for the Bootbox desktop guest (aliased over ash's builtin).
# PURE ASCII only: the `fixed` X font has no glyphs for em-dash / bullet / emoji, so any
# non-ASCII char renders as garbage in the terminal. Keep this file 7-bit ASCII.
cat <<'EOF'

  BOOTBOX LINUX - commands & apps
  ===============================
  GRAPHICAL APPS (open on the desktop)
    dillo [url]     web browser (graphical; CSS, no JS)
    pcmanfm         file manager (windows)
    xterm           another terminal window

  TERMINAL
    claude          Claude Code (official CLI). To sign in: open the printed
                    URL in Safari on this iPad, paste the code back here.
    python3         Python 3.12 REPL     pip install X   (fast, via uv)
    mc              file manager (TUI)   links URL        text browser
    htop  ncdu  tree  nano  less  tmux   the usual tools

  FILES
    the bottom panel  app launcher icons (one tap)
    /share          folder shared with the iPad Files app

  TIPS
    - right-click (two-finger tap) the wallpaper for the app menu
    - the app icons in the bottom panel launch with one tap
    - the iPad pointer IS the mouse: tap = click, two-finger tap = right-click
    - type 'help' to show this again

EOF

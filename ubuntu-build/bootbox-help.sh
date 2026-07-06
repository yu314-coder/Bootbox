#!/bin/sh
# bootbox-help — the real `help` for the Bootbox desktop guest (aliased over ash's builtin).
cat <<'EOF'

  BOOTBOX LINUX — commands & apps
  ================================
  GRAPHICAL (appear in the desktop / 🖥️ GUI pane)
    dillo [url]        web browser (graphical, CSS; no JS)
    pcmanfm            file manager (windows + the desktop icons)
    xterm              another terminal window

  TERMINAL
    claude             Claude Code (official CLI) — sign in: open the printed
                       URL in Safari on this iPad, paste the code back here
    python3            Python 3.12 REPL        pip install X   (fast, via uv)
    mc                 file manager (TUI)      links URL       text browser
    htop / ncdu / tree / nano / tmux           the usual tools

  FILES
    /root/Desktop      the desktop icons       /share          shared with the
                                                               iPad Files app
  TIPS
    · right-click (two-finger tap) the wallpaper = app menu
    · the iPad pointer IS the mouse — tap = click, two-finger tap = right-click
    · `help` shows this again

EOF

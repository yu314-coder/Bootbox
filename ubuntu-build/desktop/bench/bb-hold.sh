# bb-hold.sh - sourced by every benchmark (desktop v17): while one runs, the desktop's own background
# work keeps out of the way so it doesn't eat into the score.
#   * xstart pre-starts the Linux browser hidden ~2 min after the desktop appears; WebKit then needs
#     1-3 min of CPU on the emulated machine. On the iPad that landed in CPU-Z's multi-thread phase
#     whenever CPU-Z was started right after boot. The pre-start now waits while /tmp/.bb-bench has a
#     live benchmark, and one already under way (/tmp/.bbweb-prewarming, removed by the engine once its
#     start page has loaded) is paused with SIGSTOP and continued when the benchmark ends.
#   * Only the hidden pre-start is ever paused - a browser window the user opened is left alone.
# Nested benchmarks (bench-all -> cpuz-bench) share the first one's pause.
mkdir -p /tmp/.bb-bench 2>/dev/null
_bb_first=1
for _bb_f in /tmp/.bb-bench/*; do
  [ -e "$_bb_f" ] || continue
  _bb_p=${_bb_f##*/}
  if kill -0 "$_bb_p" 2>/dev/null; then _bb_first=0; else rm -f "$_bb_f"; fi
done
: > "/tmp/.bb-bench/$$"
_bb_paused=""
if [ "$_bb_first" = 1 ] && [ -e /tmp/.bbweb-prewarming ]; then
  # by process name (/proc/N/comm, 15 chars), never by command line: a shell whose command line merely
  # mentions WebKit must not be stopped
  for _bb_d in /proc/[0-9]*; do
    read -r _bb_c 2>/dev/null < "$_bb_d/comm" || continue
    case "$_bb_c" in
      bbweb-engine|WebKitWebProces*|WebKitNetworkPr*)
        _bb_p=${_bb_d#/proc/}; kill -STOP "$_bb_p" 2>/dev/null && _bb_paused="$_bb_paused $_bb_p" ;;
    esac
  done
  [ -n "$_bb_paused" ] && echo "(The browser's background start is paused until this benchmark ends.)"
fi
_bb_release() {
  rm -f "/tmp/.bb-bench/$$"
  [ -n "$_bb_paused" ] && kill -CONT $_bb_paused 2>/dev/null
  _bb_paused=""
}
trap '_bb_release' EXIT
trap '_bb_release; exit 130' INT TERM HUP
unset _bb_f _bb_p _bb_d _bb_c _bb_first

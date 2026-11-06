// bbweb (launcher) - what the panel, menu and `web` run. Starting WebKit takes ~15-30 s on the emulated
// CPU (the engine's libraries alone load for seconds before main()), so this tiny Xlib program:
//   * hands the URL to an already running browser over /tmp/.bbweb.sock (it opens a tab and comes to
//     the front) instead of starting a second ~340 MB copy;
//   * otherwise shows an "Opening..." card at once, starts /usr/libexec/bbweb-engine and closes the card
//     when the engine's window is drawn (the engine writes to BBWEB_READY_FD) or the engine exits;
//   * a tap while an engine is still starting (the boot-time pre-start, or a first tap) shows the card
//     too and hands its URL over as soon as that engine listens (it holds /tmp/.bbweb.lock);
//   * `bbweb --prewarm` (xstart, after boot) starts the engine hidden with no card, so the first
//     real tap opens a browser that is already running.
//   * desktop v14, inside the Bootbox app (/share/.bootbox/native-web exists): web pages open in the app's
//     native browser instead - the iPad's own WebKit, hundreds of times faster than WebKit on the
//     emulated CPU. `bbweb --linux [URL]`, bootbox:// and file: pages keep this Linux browser.
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define SOCK_PATH "/tmp/.bbweb.sock"
#define LOCK_PATH "/tmp/.bbweb.lock"
#define ENGINE "/usr/libexec/bbweb-engine"
#define MIMALLOC "/usr/lib/libmimalloc-insecure.so.2"   /* the plain build: Alpine's libmimalloc.so.2 = the slower "secure" one */
#define NATIVE_FLAG "/share/.bootbox/native-web"

// WebKit's own allocator (libpas) hands freed memory back with madvise and faults it in again, thousands
// of times per page load - each round trip a page fault + TLB flush on the emulated CPU. Malloc=1 makes
// WebKit use the system malloc, here mimalloc, which keeps freed memory for 2 s: page loads ~17% faster,
// kernel time -65%, same RSS (measured on offline Wikipedia/GitHub copies). Its processes inherit it.
static void engine_env(void) {
  if (access(MIMALLOC, R_OK) != 0) return;
  setenv("Malloc", "1", 0);
  setenv("LD_PRELOAD", MIMALLOC, 0);
  setenv("MIMALLOC_PURGE_DELAY", "2000", 0);
}

// Ask the Bootbox app to open URL (or search words; "" = its start page) in its native browser: an OSC
// 7777 "open;<text>" sequence on the console, which the app's terminal (run.js) turns into a request.
static int open_native(const char *url) {
  if (access(NATIVE_FLAG, R_OK) != 0) return 0;
  int fd = open("/dev/console", O_WRONLY | O_NOCTTY | O_CLOEXEC);
  if (fd < 0) return 0;
  char buf[4200];
  int n = snprintf(buf, sizeof buf, "\033]7777;open;");
  for (const char *p = url; *p && n < (int)sizeof buf - 2; p++)
    if ((unsigned char)*p >= 0x20 && *p != 0x7f) buf[n++] = *p;   // no control chars inside the sequence
  buf[n++] = '\a';
  int ok = write(fd, buf, n) == n;
  close(fd);
  return ok;
}

static int send_to_running(const char *url) {
  int s = socket(AF_UNIX, SOCK_STREAM, 0);
  if (s < 0) return 0;
  struct sockaddr_un a = { .sun_family = AF_UNIX };
  strncpy(a.sun_path, SOCK_PATH, sizeof a.sun_path - 1);
  if (connect(s, (struct sockaddr *)&a, sizeof a) != 0) { close(s); return 0; }
  dprintf(s, "%s\n", url);
  close(s);
  return 1;
}

static unsigned long rgb(Display *d, const char *spec) {
  XColor c, exact;
  return XAllocNamedColor(d, DefaultColormap(d, DefaultScreen(d)), spec, &c, &exact) ? c.pixel : 0;
}

int main(int argc, char **argv) {
  char **orig_argv = argv;
  int linux_only = argc > 1 && !strcmp(argv[1], "--linux");   // this Linux browser, never the native one
  if (linux_only) { argv++; argc--; }
  // The URL / search words, joined (the engine treats "" as the start page).
  char url[4096] = "";
  for (int i = 1; i < argc; i++) {
    if (i > 1) strncat(url, " ", sizeof url - strlen(url) - 1);
    strncat(url, argv[i], sizeof url - strlen(url) - 1);
  }
  for (char *p = url; *p; p++) if (*p == '\n') *p = ' ';
  int prewarm = argc > 1 && !strcmp(argv[1], "--prewarm");
  if (!prewarm && !linux_only && strncmp(url, "bootbox:", 8) && strncmp(url, "file:", 5) && open_native(url)) return 0;
  // (a pre-start never talks to a running engine: an empty request would bring its window up)
  if (!prewarm && send_to_running(url)) return 0;

  int lock = open(LOCK_PATH, O_RDWR | O_CREAT | O_CLOEXEC, 0600);
  int starting = lock >= 0 && flock(lock, LOCK_EX | LOCK_NB) != 0;   // an engine runs or is starting
  if (starting && prewarm) return 0;
  if (lock >= 0 && !starting) fcntl(lock, F_SETFD, 0);               // the engine inherits (keeps) the lock
  if (prewarm) {
    if (fork() == 0) { setsid(); engine_env(); argv[0] = (char *)ENGINE; execv(ENGINE, argv); _exit(127); }
    return 0;
  }

  int ready[2] = { -1, -1 };
  pid_t pid = -1;
  if (starting) {
    // keep the lock fd: if the engine holding it exits instead of listening (it was just closed and is
    // quitting, v16), the lock frees up and this launcher starts over and starts a new engine.
  } else {
  if (pipe(ready) != 0) ready[0] = ready[1] = -1;
  pid = fork();
  if (pid == 0) {
    if (ready[0] >= 0) close(ready[0]);
    char fd[16];
    snprintf(fd, sizeof fd, "%d", ready[1]);
    setenv("BBWEB_READY_FD", fd, 1);
    setsid();
    engine_env();
    argv[0] = (char *)ENGINE;
    execv(ENGINE, argv);
    _exit(127);
  }
  if (ready[1] >= 0) close(ready[1]);
  if (lock >= 0) close(lock);
  if (pid < 0) return 1;
  }

  // The card: an undecorated box in the middle of the screen, drawn with a core font.
  Display *d = XOpenDisplay(NULL);
  Window w = 0;
  GC gc = 0;
  XFontStruct *f = NULL, *fs = NULL;
  int W = 380, H = 104;
  unsigned long fg = 0, dim = 0, bg = 0;
  if (d) {
    int scr = DefaultScreen(d);
    bg = rgb(d, "#121a27"); fg = rgb(d, "#e6eefa"); dim = rgb(d, "#7f8ea6");
    XSetWindowAttributes at = { .override_redirect = True, .background_pixel = bg,
                                .border_pixel = rgb(d, "#3d8bfd") };
    w = XCreateWindow(d, RootWindow(d, scr), (DisplayWidth(d, scr) - W) / 2, (DisplayHeight(d, scr) - H) / 2 - 40,
                      W, H, 2, CopyFromParent, InputOutput, CopyFromParent,
                      CWOverrideRedirect | CWBackPixel | CWBorderPixel, &at);
    XSelectInput(d, w, ExposureMask);
    gc = XCreateGC(d, w, 0, NULL);
    f = XLoadQueryFont(d, "9x15bold");
    if (!f) f = XLoadQueryFont(d, "fixed");
    fs = XLoadQueryFont(d, "6x13");
    if (!fs) fs = f;
    XMapRaised(d, w);
    XFlush(d);
  }
  const char *title = "Opening the web browser";
  const char *sub = "The first start takes a little while.";
  int dots = 0;
  time_t t0 = time(NULL);
  for (;;) {
    if (d && w) {
      XClearWindow(d, w);
      char line[64];
      snprintf(line, sizeof line, "%s%.*s", title, dots, "...");
      if (f) { XSetFont(d, gc, f->fid); }
      XSetForeground(d, gc, fg);
      XDrawString(d, w, gc, 24, 44, line, strlen(line));
      if (fs) { XSetFont(d, gc, fs->fid); }
      XSetForeground(d, gc, dim);
      XDrawString(d, w, gc, 24, 72, sub, strlen(sub));
      XFlush(d);
      while (XPending(d)) { XEvent e; XNextEvent(d, &e); }
    }
    dots = (dots + 1) % 4;
    fd_set rf;
    FD_ZERO(&rf);
    int mx = -1;
    if (ready[0] >= 0) { FD_SET(ready[0], &rf); mx = ready[0]; }
    struct timeval tv = { 0, 500000 };
    int r = select(mx + 1, &rf, NULL, NULL, &tv);
    if (r > 0) break;                                   // the window is up (a byte) or the engine died (EOF)
    if (r < 0 && errno != EINTR) break;
    if (time(NULL) - t0 > 240) break;
    if (starting) {                                     // someone else's engine: hand over once it listens
      if (send_to_running(url)) break;
      if (lock >= 0 && flock(lock, LOCK_EX | LOCK_NB) == 0) {   // ...or it exited without listening
        close(lock);
        if (d) XCloseDisplay(d);
        execv("/proc/self/exe", orig_argv);
        return 1;
      }
    } else if (waitpid(pid, NULL, WNOHANG) == pid) break;
  }
  if (starting && lock >= 0) close(lock);
  if (d) XCloseDisplay(d);
  return 0;
}

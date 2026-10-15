// bbkey KEYSYM... - press the keys in order and release them in reverse through XTEST.
// `bbkey Super_L space` opens openbox's app menu (rc.xml's W-space). Replaces xdotool for the panel's
// Apps button: xdotool's start-up (13 libraries, keyboard-map queries) cost ~0.4 s on the emulated CPU.
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>

int main(int argc, char **argv) {
  Display *d = XOpenDisplay(NULL);
  if (!d) return 1;
  KeyCode kc[16];
  int n = 0;
  for (int i = 1; i < argc && n < 16; i++) {
    KeySym ks = XStringToKeysym(argv[i]);
    KeyCode c = ks == NoSymbol ? 0 : XKeysymToKeycode(d, ks);
    if (c) kc[n++] = c;
  }
  for (int i = 0; i < n; i++) XTestFakeKeyEvent(d, kc[i], True, CurrentTime);
  for (int i = n - 1; i >= 0; i--) XTestFakeKeyEvent(d, kc[i], False, CurrentTime);
  XCloseDisplay(d);
  return n ? 0 : 2;
}

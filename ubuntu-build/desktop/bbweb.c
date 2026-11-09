// bbweb-engine - the Bootbox desktop's web browser: WebKitGTK (a current engine with full JavaScript)
// behind a plain toolbar (back, forward, reload, home, address/search bar, new tab) and tabs. Tuned for
// the emulated CPU: no GPU paths (no compositing / WebGL, and Mesa is hidden from it - just probing EGL
// loaded LLVM + the llvmpipe driver, ~100 MB of libraries), no smooth-scroll animation, no autoplay.
// Started by the `bbweb` launcher (bbweb-launch.c), which shows a card until BBWEB_READY_FD is written.
// Single instance: later launches send their URL over /tmp/.bbweb.sock -> a new tab, window to front.
// xstart pre-starts it hidden after boot (`--prewarm`), so the first Web tap is instant instead of ~20 s.
// Closing the window (or its last tab) quits it (v16; it used to only hide, which left ~220 MB of
// processes running and looked like the browser never closed).
// bootbox://app/ pages: start, hub (Benchmarks), webbench; .../run/<id> starts a whitelisted
// benchmark, .../results and .../save?j=<json> read and append ~/.bootbox/results.jsonl.
// Lite (toolbar): mobile site versions, no images - much lighter pages on the emulated CPU.
// One web process for everything (v13): starting a WebKitWebProcess costs ~10 s on the emulated CPU, so
// tabs share the first tab's process (related-view) and cross-site navigation does not swap processes
// (feature ProcessSwapOnCrossSiteNavigation off). Hidden tabs are throttled by WebKit; if the shared
// process dies, every view reloads itself (at most once a minute).
//   bbweb [URL]        URL or search words; no argument = the local start page
//   BBWEB_LOG=1        print page titles + start-up phases to stdout (the image build's smoke test)
#include <gtk/gtk.h>
#include <gio/gunixsocketaddress.h>
#include <webkit2/webkit2.h>
#include <libsoup/soup.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define SOCK_PATH "/tmp/.bbweb.sock"
#define PREWARM_MARK "/tmp/.bbweb-prewarming"   // v17: xstart creates it before a pre-start

#define HOME_URI "bootbox://app/start"
#define SHARE "/usr/share/bootbox/"
#define LITE_FLAG "/root/.config/bbweb/lite"
#define NOBLOCK_FLAG "/root/.config/bbweb/noblock"
#define NATIVE_FLAG "/share/.bootbox/native-web"   // inside the Bootbox app: its native browser exists (v14)
#define RESULTS "/root/.bootbox/results.jsonl"
#define MOBILE_UA "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
#define SEARCH_URI "https://lite.duckduckgo.com/lite/?q="

static GtkWidget *win, *nb, *entry, *back_btn, *fwd_btn, *reload_btn;
static WebKitSettings *settings;
static gboolean log_titles, prewarm;
static GtkWidget *lite_btn;

// BBWEB_LOG: phase timestamps on the guest's uptime clock (compare with `cat /proc/uptime` at launch).
static void phase(const char *what) {
  if (!log_titles) return;
  char b[64] = "";
  FILE *f = fopen("/proc/uptime", "r");
  if (f) { if (!fgets(b, sizeof b, f)) b[0] = 0; fclose(f); }
  char *sp = strchr(b, ' ');
  if (sp) *sp = 0;
  printf("phase %s %s\n", b, what);
  fflush(stdout);
}
// v16: a freshly opened window sometimes showed a strip of the page unpainted (grey, e.g. the hub's left
// margin) until something covered and uncovered it: WebKit had drawn it, GTK had not copied it to the
// window. Redrawing the view shortly after a load finishes (and once more for late layout) copies it all.
static gboolean redraw_view(gpointer w) { gtk_widget_queue_draw(GTK_WIDGET(w)); g_object_unref(w); return G_SOURCE_REMOVE; }
static void on_load_changed(WebKitWebView *v, WebKitLoadEvent e, gpointer d) {
  (void)d;
  phase(e == WEBKIT_LOAD_STARTED ? "load-started" : e == WEBKIT_LOAD_COMMITTED ? "load-committed" :
        e == WEBKIT_LOAD_FINISHED ? "load-finished" : "load-redirected");
  if (e == WEBKIT_LOAD_FINISHED) {
    g_timeout_add(300, redraw_view, g_object_ref(v));
    g_timeout_add(1500, redraw_view, g_object_ref(v));
    // v17: the hidden pre-start has loaded its start page = its start-up work is done. Benchmarks
    // (bb-hold.sh) pause the engine only while this marker exists.
    if (prewarm) unlink(PREWARM_MARK);
  }
}

static WebKitWebView *current_view(void) {
  int i = gtk_notebook_get_current_page(GTK_NOTEBOOK(nb));
  return i < 0 ? NULL : WEBKIT_WEB_VIEW(gtk_notebook_get_nth_page(GTK_NOTEBOOK(nb), i));
}

// Typed text -> URI: keep real URIs, add https:// to bare host names, search everything else.
static gchar *to_uri(const char *t) {
  while (*t == ' ') t++;
  if (!*t) return g_strdup(HOME_URI);
  if (strstr(t, "://") || g_str_has_prefix(t, "about:") || g_str_has_prefix(t, "file:")) return g_strdup(t);
  if (!strchr(t, ' ') && (strchr(t, '.') || g_str_has_prefix(t, "localhost")))
    return g_strdup_printf("%s://%s", g_str_has_prefix(t, "localhost") ? "http" : "https", t);
  gchar *q = g_uri_escape_string(t, NULL, TRUE), *u = g_strconcat(SEARCH_URI, q, NULL);
  g_free(q);
  return u;
}

static void sync_toolbar(void) {
  WebKitWebView *v = current_view();
  if (!v) return;
  const char *u = webkit_web_view_get_uri(v), *t = webkit_web_view_get_title(v);
  if (!gtk_widget_has_focus(entry))
    gtk_entry_set_text(GTK_ENTRY(entry), u && strcmp(u, HOME_URI) ? u : "");
  gtk_widget_set_sensitive(back_btn, webkit_web_view_can_go_back(v));
  gtk_widget_set_sensitive(fwd_btn, webkit_web_view_can_go_forward(v));
  gboolean loading = webkit_web_view_is_loading(v);
  gtk_button_set_image(GTK_BUTTON(reload_btn), gtk_image_new_from_icon_name(
      loading ? "process-stop-symbolic" : "view-refresh-symbolic", GTK_ICON_SIZE_LARGE_TOOLBAR));
  gtk_entry_set_progress_fraction(GTK_ENTRY(entry), loading ? webkit_web_view_get_estimated_load_progress(v) : 0.0);
  gchar *wt = g_strdup_printf("%s - Web", t && *t ? t : "New tab");
  gtk_window_set_title(GTK_WINDOW(win), wt);
  g_free(wt);
}

static void tab_label_update(WebKitWebView *v) {
  GtkWidget *box = gtk_notebook_get_tab_label(GTK_NOTEBOOK(nb), GTK_WIDGET(v));
  if (!box) return;
  GtkWidget *label = g_object_get_data(G_OBJECT(box), "label");
  const char *t = webkit_web_view_get_title(v);
  gtk_label_set_text(GTK_LABEL(label), t && *t ? t : "New tab");
}

static void on_view_changed(WebKitWebView *v, GParamSpec *ps, gpointer d) {
  (void)d;
  if (!strcmp(ps->name, "title")) {
    tab_label_update(v);
    const char *t = webkit_web_view_get_title(v);
    if (log_titles && t && *t) { printf("title: %s\n", t); fflush(stdout); }
  }
  if (v == current_view()) sync_toolbar();
}

// Closing the window (or its last tab) quits: the window goes at once, then the engine leaves its main
// loop and exits, and WebKit's web and network processes exit with it. The socket goes first, so a
// launcher started meanwhile starts a new engine instead of handing its URL to this one (bbweb-launch.c).
static void quit_browser(void) {
  unlink(SOCK_PATH);
  gtk_widget_hide(win);
  gtk_main_quit();
}
static gboolean on_delete(GtkWidget *w, GdkEvent *e, gpointer d) { (void)w; (void)e; (void)d; quit_browser(); return TRUE; }

static void close_tab(WebKitWebView *v) {
  int i = gtk_notebook_page_num(GTK_NOTEBOOK(nb), GTK_WIDGET(v));
  if (i < 0) return;
  if (gtk_notebook_get_n_pages(GTK_NOTEBOOK(nb)) == 1) { quit_browser(); return; }
  gtk_notebook_remove_page(GTK_NOTEBOOK(nb), i);
}
static void on_close_clicked(GtkButton *b, gpointer v) { (void)b; close_tab(WEBKIT_WEB_VIEW(v)); }
static void on_view_close(WebKitWebView *v, gpointer d) { (void)d; close_tab(v); }

// Ad/tracker blocking (v13): third-party requests to these hosts are dropped (a WebKit content filter,
// compiled once into ~/.cache/bbweb/filters). Their scripts would otherwise run on the emulated CPU - on
// news sites most of the JavaScript is ads and analytics. Off: touch ~/.config/bbweb/noblock.
static const char *const BLOCK_HOSTS[] = {
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com",
  "googletagmanager.com", "googletagservices.com", "adservice.google.com", "googleoptimize.com",
  "facebook.net", "scorecardresearch.com", "chartbeat.com", "chartbeat.net", "optimizely.com", "hotjar.com",
  "amazon-adsystem.com", "adnxs.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
  "quantserve.com", "moatads.com", "adsrvr.org", "rubiconproject.com", "pubmatic.com", "openx.net",
  "casalemedia.com", "33across.com", "sharethrough.com", "teads.tv", "yieldmo.com", "adform.net",
  "smartadserver.com", "indexww.com", "bidswitch.net", "rlcdn.com", "demdex.net", "omtrdc.net",
  "everesttech.net", "krxd.net", "bluekai.com", "exelator.com", "mathtag.com", "tapad.com", "agkn.com",
  "crwdcntrl.net", "permutive.com", "permutive.app", "mixpanel.com", "nr-data.net", "clarity.ms",
  "bat.bing.com", "doubleverify.com", "adsafeprotected.com", "imrworldwide.com", "cxense.com",
  "snap.licdn.com", "ads.linkedin.com", "analytics.twitter.com", "ads-twitter.com", "analytics.tiktok.com",
  "ads.yahoo.com", "adroll.com", "zemanta.com", "media.net", "lijit.com", "sonobi.com", "gumgum.com",
  "tiqcdn.com", "ensighten.com", "parsely.com", "parse.ly", "newrelic.com", "branch.io", "segment.com",
  "segment.io", "amplitude.com", "fullstory.com", "mouseflow.com", "quantcount.com", "adition.com",
};
static WebKitUserContentManager *ucm;
static void on_filter_saved(GObject *o, GAsyncResult *r, gpointer d) {
  (void)d; GError *e = NULL;
  WebKitUserContentFilter *f = webkit_user_content_filter_store_save_finish(WEBKIT_USER_CONTENT_FILTER_STORE(o), r, &e);
  if (!f) { fprintf(stderr, "bbweb: content filter: %s\n", e ? e->message : "?"); if (e) g_error_free(e); return; }
  webkit_user_content_manager_add_filter(ucm, f);
  webkit_user_content_filter_unref(f);
  phase("blocker-on");
}
static void setup_blocker(void) {
  GString *j = g_string_new("[");
  for (gsize i = 0; i < G_N_ELEMENTS(BLOCK_HOSTS); i++) {
    gchar *h = g_regex_escape_string(BLOCK_HOSTS[i], -1), *hj = g_strescape(h, NULL);
    g_string_append_printf(j, "%s{\"trigger\":{\"url-filter\":\"^https?://([^/]+\\\\.)?%s[/:]\",\"load-type\":[\"third-party\"]},\"action\":{\"type\":\"block\"}}",
                           i ? "," : "", hj);
    g_free(h); g_free(hj);
  }
  g_string_append(j, "]");
  gchar *dir = g_build_filename(g_get_user_cache_dir(), "bbweb", "filters", NULL);
  WebKitUserContentFilterStore *st = webkit_user_content_filter_store_new(dir);
  gsize len = j->len;
  GBytes *b = g_bytes_new_take(g_string_free(j, FALSE), len);
  webkit_user_content_filter_store_save(st, "bootbox-block-1", b, NULL, on_filter_saved, NULL);
  g_bytes_unref(b); g_free(dir);
}

static WebKitWebView *add_tab(WebKitWebView *related, const char *uri, gboolean focus);

// window.open() / target=_blank: a new tab sharing the opener's web process.
static GtkWidget *on_create(WebKitWebView *v, WebKitNavigationAction *a, gpointer d) {
  (void)a; (void)d;
  return GTK_WIDGET(add_tab(v, NULL, TRUE));
}

static gboolean on_load_failed_tls(WebKitWebView *v, gchar *uri, GTlsCertificate *c, GTlsCertificateFlags e, gpointer d) {
  (void)c; (void)e; (void)d;
  gchar *html = g_strdup_printf("<body style='font:16px sans-serif;background:#0b0f17;color:#d6e2f2;padding:40px'>"
      "<h2>Not a secure connection</h2><p>The certificate of <b>%s</b> could not be verified, so the page was not loaded.</p></body>", uri);
  webkit_web_view_load_alternate_html(v, html, uri, NULL);
  g_free(html);
  return TRUE;
}

static void on_web_process_terminated(WebKitWebView *v, WebKitWebProcessTerminationReason r, gpointer d) {
  (void)r; (void)d;
  gint64 now = g_get_monotonic_time(), last = GPOINTER_TO_SIZE(g_object_get_data(G_OBJECT(v), "bb-crash")) * G_USEC_PER_SEC;
  if (last && now - last < 60 * G_USEC_PER_SEC) return;   // crashed again within a minute: leave the error page
  g_object_set_data(G_OBJECT(v), "bb-crash", GSIZE_TO_POINTER((gsize)(now / G_USEC_PER_SEC)));
  webkit_web_view_reload(v);
}

static WebKitWebView *add_tab(WebKitWebView *related, const char *uri, gboolean focus) {
  if (!related && gtk_notebook_get_n_pages(GTK_NOTEBOOK(nb)) > 0)   // share the existing web process
    related = WEBKIT_WEB_VIEW(gtk_notebook_get_nth_page(GTK_NOTEBOOK(nb), 0));
  WebKitWebView *v = related
      ? WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW, "related-view", related, "settings", settings, "user-content-manager", ucm, NULL))
      : WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW, "settings", settings, "user-content-manager", ucm, NULL));
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
  GtkWidget *label = gtk_label_new("New tab");
  gtk_label_set_ellipsize(GTK_LABEL(label), PANGO_ELLIPSIZE_END);
  gtk_label_set_width_chars(GTK_LABEL(label), 16);
  gtk_label_set_max_width_chars(GTK_LABEL(label), 16);
  GtkWidget *x = gtk_button_new_from_icon_name("window-close-symbolic", GTK_ICON_SIZE_MENU);
  gtk_button_set_relief(GTK_BUTTON(x), GTK_RELIEF_NONE);
  g_signal_connect(x, "clicked", G_CALLBACK(on_close_clicked), v);
  gtk_box_pack_start(GTK_BOX(box), label, TRUE, TRUE, 0);
  gtk_box_pack_start(GTK_BOX(box), x, FALSE, FALSE, 0);
  g_object_set_data(G_OBJECT(box), "label", label);
  gtk_widget_show_all(box);
  for (const char **p = (const char *[]){ "notify::uri", "notify::title", "notify::estimated-load-progress",
                                          "notify::is-loading", NULL }; *p; p++)
    g_signal_connect(v, *p, G_CALLBACK(on_view_changed), NULL);
  g_signal_connect(v, "create", G_CALLBACK(on_create), NULL);
  g_signal_connect(v, "close", G_CALLBACK(on_view_close), NULL);
  g_signal_connect(v, "load-failed-with-tls-errors", G_CALLBACK(on_load_failed_tls), NULL);
  g_signal_connect(v, "load-changed", G_CALLBACK(on_load_changed), NULL);
  g_signal_connect(v, "web-process-terminated", G_CALLBACK(on_web_process_terminated), NULL);
  gtk_widget_show(GTK_WIDGET(v));
  int i = gtk_notebook_append_page(GTK_NOTEBOOK(nb), GTK_WIDGET(v), box);
  gtk_notebook_set_tab_reorderable(GTK_NOTEBOOK(nb), GTK_WIDGET(v), TRUE);
  gtk_notebook_set_show_tabs(GTK_NOTEBOOK(nb), gtk_notebook_get_n_pages(GTK_NOTEBOOK(nb)) > 1);
  if (focus) gtk_notebook_set_current_page(GTK_NOTEBOOK(nb), i);
  if (uri) { gchar *u = to_uri(uri); webkit_web_view_load_uri(v, u); g_free(u); }
  return v;
}

static void on_page_removed(GtkNotebook *n, GtkWidget *c, guint i, gpointer d) {
  (void)c; (void)i; (void)d;
  gtk_notebook_set_show_tabs(n, gtk_notebook_get_n_pages(n) > 1);
}
static void on_switch_page(GtkNotebook *n, GtkWidget *p, guint i, gpointer d) {
  (void)n; (void)p; (void)i; (void)d;
  g_idle_add_once((GSourceOnceFunc)sync_toolbar, NULL);
}

static void on_entry_activate(GtkEntry *e, gpointer d) {
  (void)d;
  WebKitWebView *v = current_view();
  gchar *u = to_uri(gtk_entry_get_text(e));
  if (v) { webkit_web_view_load_uri(v, u); gtk_widget_grab_focus(GTK_WIDGET(v)); }
  g_free(u);
}
static void on_back(GtkButton *b, gpointer d) { (void)b; (void)d; if (current_view()) webkit_web_view_go_back(current_view()); }
static void on_fwd(GtkButton *b, gpointer d) { (void)b; (void)d; if (current_view()) webkit_web_view_go_forward(current_view()); }
static void on_reload(GtkButton *b, gpointer d) {
  (void)b; (void)d;
  WebKitWebView *v = current_view();
  if (!v) return;
  if (webkit_web_view_is_loading(v)) webkit_web_view_stop_loading(v); else webkit_web_view_reload(v);
}
static void on_home(GtkButton *b, gpointer d) { (void)b; (void)d; if (current_view()) webkit_web_view_load_uri(current_view(), HOME_URI); }
static void on_new_tab(GtkButton *b, gpointer d) { (void)b; (void)d; add_tab(NULL, HOME_URI, TRUE); gtk_widget_grab_focus(entry); }

// Fast (toolbar, only inside the Bootbox app): hand the page to the app's native browser - the iPad's own
// WebKit - with the same console request the bbweb launcher uses (OSC 7777 "open;<url>").
static void on_fast(GtkButton *b, gpointer d) {
  (void)b; (void)d;
  WebKitWebView *v = current_view();
  const char *u = v ? webkit_web_view_get_uri(v) : NULL;
  if (!u || !g_str_has_prefix(u, "http")) u = "";
  int fd = open("/dev/console", O_WRONLY | O_NOCTTY | O_CLOEXEC);
  if (fd < 0) return;
  GString *g = g_string_new("\033]7777;open;");
  for (const char *p = u; *p; p++) if ((unsigned char)*p >= 0x20 && *p != 0x7f) g_string_append_c(g, *p);
  g_string_append_c(g, '\a');
  if (write(fd, g->str, g->len) < 0) {}
  close(fd);
  g_string_free(g, TRUE);
}

static void zoom(double f) {
  WebKitWebView *v = current_view();
  if (v) webkit_web_view_set_zoom_level(v, f == 0 ? 1.0 : CLAMP(webkit_web_view_get_zoom_level(v) * f, 0.3, 4.0));
}

static gboolean on_key(GtkWidget *w, GdkEventKey *ev, gpointer d) {
  (void)w; (void)d;
  guint k = gdk_keyval_to_lower(ev->keyval);
  gboolean ctrl = ev->state & GDK_CONTROL_MASK, alt = ev->state & GDK_MOD1_MASK;
  if (ctrl && k == GDK_KEY_l) { gtk_widget_grab_focus(entry); gtk_editable_select_region(GTK_EDITABLE(entry), 0, -1); return TRUE; }
  if (ctrl && k == GDK_KEY_t) { on_new_tab(NULL, NULL); return TRUE; }
  if (ctrl && k == GDK_KEY_w) { if (current_view()) close_tab(current_view()); return TRUE; }
  if ((ctrl && k == GDK_KEY_r) || k == GDK_KEY_F5) { on_reload(NULL, NULL); return TRUE; }
  if (alt && k == GDK_KEY_Left) { on_back(NULL, NULL); return TRUE; }
  if (alt && k == GDK_KEY_Right) { on_fwd(NULL, NULL); return TRUE; }
  if (ctrl && (k == GDK_KEY_plus || k == GDK_KEY_equal)) { zoom(1.1); return TRUE; }
  if (ctrl && k == GDK_KEY_minus) { zoom(1 / 1.1); return TRUE; }
  if (ctrl && k == GDK_KEY_0) { zoom(0); return TRUE; }
  if (ctrl && k == GDK_KEY_Tab) {
    int n = gtk_notebook_get_n_pages(GTK_NOTEBOOK(nb));
    gtk_notebook_set_current_page(GTK_NOTEBOOK(nb), (gtk_notebook_get_current_page(GTK_NOTEBOOK(nb)) + 1) % n);
    return TRUE;
  }
  return FALSE;
}

static void apply_lite(gboolean on) {
  g_object_set(settings, "auto-load-images", !on, NULL);
  webkit_settings_set_user_agent(settings, on ? MOBILE_UA : NULL);
}
static void on_lite_toggled(GtkToggleButton *b, gpointer d) {
  (void)d;
  gboolean on = gtk_toggle_button_get_active(b);
  apply_lite(on);
  if (on) { g_mkdir_with_parents("/root/.config/bbweb", 0755); g_file_set_contents(LITE_FLAG, "1\n", -1, NULL); }
  else unlink(LITE_FLAG);
  if (current_view()) webkit_web_view_reload(current_view());
}

// --- bootbox:// -------------------------------------------------------------------------------------
// Benchmarks the hub may start: id -> command. Nothing else is ever run from a page.
// Benchmarks start without the browser's own environment (allocator, hidden Mesa, WebKit switches).
static gboolean spawn_clean(const char *cmd) {
  gchar **argv = NULL;
  if (!g_shell_parse_argv(cmd, NULL, &argv, NULL)) return FALSE;
  gchar **env = g_get_environ();
  /* LIBGL_DRIVERS_PATH=/nonexistent hides Mesa from WebKit (see main) - glmark2 started from the hub needs it */
  for (const char **k = (const char *[]){ "LD_PRELOAD", "Malloc", "MIMALLOC_PURGE_DELAY", "LIBGL_DRIVERS_PATH",
                                          "WEBKIT_DISABLE_COMPOSITING_MODE", "WEBKIT_DISABLE_DMABUF_RENDERER", NULL }; *k; k++)
    env = g_environ_unsetenv(env, *k);
  gboolean ok = g_spawn_async(NULL, argv, env, G_SPAWN_SEARCH_PATH, NULL, NULL, NULL, NULL);
  g_strfreev(argv);
  g_strfreev(env);
  return ok;
}

static const char *const RUNNABLE[][2] = {
  { "cpuz",     "bxterm -T 'CPU-Z benchmark' -geometry 80x22 -e sh -c 'cpuz-bench; echo; printf \"Press Enter to close\"; read x'" },
  { "cpuzwin",  "cpuz-gui" },
  { "7zip",     "bxterm -T '7-Zip benchmark' -geometry 88x26 -e sh -c '7z-bench; echo; printf \"Press Enter to close\"; read x'" },
  { "sysbench", "bxterm -T 'sysbench CPU' -geometry 80x22 -e sh -c 'sysbench-bench; echo; printf \"Press Enter to close\"; read x'" },
  { "gpu",      "bxterm -T 'GPU benchmark' -geometry 90x24 -e sh -c 'gpu-bench; echo; printf \"Press Enter to close\"; read x'" },
  { "monitor",  "bxterm -T 'System monitor' -geometry 100x30 -e htop" },
  { "all",      "bxterm -T 'All benchmarks' -geometry 90x34 -e sh -c 'bench-all; echo; printf \"Press Enter to close\"; read x'" },
};

// bootbox:// pages get an opaque origin in WebKit, so even their own fetches are cross-origin: every
// response says it may be read (the hub reads results, the web benchmark saves its score).
static void finish_bytes(WebKitURISchemeRequest *req, const char *type, gchar *data, gsize len) {
  GInputStream *in = g_memory_input_stream_new_from_data(data, len, g_free);
  WebKitURISchemeResponse *resp = webkit_uri_scheme_response_new(in, len);
  webkit_uri_scheme_response_set_content_type(resp, type);
  SoupMessageHeaders *h = soup_message_headers_new(SOUP_MESSAGE_HEADERS_RESPONSE);
  soup_message_headers_append(h, "Access-Control-Allow-Origin", "*");
  soup_message_headers_append(h, "Cache-Control", "no-store");
  webkit_uri_scheme_response_set_http_headers(resp, h);
  webkit_uri_scheme_request_finish_with_response(req, resp);
  g_object_unref(resp);
  g_object_unref(in);
}
static void finish_file(WebKitURISchemeRequest *req, const char *name) {
  gchar *path = g_strconcat(SHARE, name, NULL), *data = NULL;
  gsize len = 0;
  if (g_file_get_contents(path, &data, &len, NULL)) finish_bytes(req, "text/html", data, len);
  else { GError *e = g_error_new(G_IO_ERROR, G_IO_ERROR_NOT_FOUND, "%s missing", path); webkit_uri_scheme_request_finish_error(req, e); g_error_free(e); }
  g_free(path);
}

static void on_bootbox_scheme(WebKitURISchemeRequest *req, gpointer d) {
  (void)d;
  // Pages live under one origin, bootbox://app/... (bootbox://hub and bootbox://run would be two
  // origins, and WebKit hides cross-origin responses from the page); short forms still work.
  const char *uri = webkit_uri_scheme_request_get_uri(req) + strlen("bootbox://");
  if (g_str_has_prefix(uri, "app/")) uri += 4;
  if (g_str_has_prefix(uri, "start")) { finish_file(req, "start.html"); return; }
  if (g_str_has_prefix(uri, "hub")) { finish_file(req, "hub.html"); return; }
  if (g_str_has_prefix(uri, "webbench")) { finish_file(req, "webbench.html"); return; }
  if (g_str_has_prefix(uri, "results")) {
    gchar *data = NULL; gsize len = 0;
    GString *js = g_string_new("[");
    if (g_file_get_contents(RESULTS, &data, &len, NULL)) {
      gchar **lines = g_strsplit(data, "\n", -1); gboolean first = TRUE;
      for (gchar **l = lines; *l; l++) if (**l == '{') { if (!first) g_string_append_c(js, ','); g_string_append(js, *l); first = FALSE; }
      g_strfreev(lines); g_free(data);
    }
    g_string_append_c(js, ']');
    gsize n = js->len; finish_bytes(req, "application/json", g_string_free(js, FALSE), n);
    return;
  }
  if (g_str_has_prefix(uri, "save?j=")) {
    gchar *j = g_uri_unescape_string(uri + 7, NULL);
    if (j && j[0] == '{' && !strchr(j, '\n') && strlen(j) < 4096) {
      g_mkdir_with_parents("/root/.bootbox", 0755);
      FILE *f = fopen(RESULTS, "a");
      if (f) { fprintf(f, "%s\n", j); fclose(f); }
    }
    g_free(j);
    finish_bytes(req, "text/plain", g_strdup("ok"), 2);
    return;
  }
  if (g_str_has_prefix(uri, "run/")) {
    const char *id = uri + 4; gboolean ok = FALSE;
    for (gsize i = 0; i < G_N_ELEMENTS(RUNNABLE); i++)
      if (!strcmp(id, RUNNABLE[i][0])) ok = spawn_clean(RUNNABLE[i][1]);
    finish_bytes(req, "text/plain", g_strdup(ok ? "started" : "unknown"), ok ? 7 : 7);
    return;
  }
  GError *e = g_error_new(G_IO_ERROR, G_IO_ERROR_NOT_FOUND, "no such page");
  webkit_uri_scheme_request_finish_error(req, e); g_error_free(e);
}

static GtkWidget *tool_button(const char *icon, const char *tip, GCallback cb) {
  GtkWidget *b = gtk_button_new_from_icon_name(icon, GTK_ICON_SIZE_LARGE_TOOLBAR);
  gtk_widget_set_tooltip_text(b, tip);
  gtk_button_set_relief(GTK_BUTTON(b), GTK_RELIEF_NONE);
  gtk_widget_set_can_focus(b, FALSE);
  g_signal_connect(b, "clicked", cb, NULL);
  return b;
}

static gboolean on_first_draw(GtkWidget *w, cairo_t *cr, gpointer d) {
  (void)cr; (void)d;
  phase("window-drawn");
  g_signal_handlers_disconnect_by_func(w, on_first_draw, NULL);
  const char *fd = getenv("BBWEB_READY_FD");   // tell the launcher to take its card down
  if (fd) { int n = atoi(fd); if (n > 2) { if (write(n, "1", 1) < 0) {} close(n); } unsetenv("BBWEB_READY_FD"); }
  return FALSE;
}

// Another `bbweb [URL]`: open the URL in a new tab (none: just bring the window up).
static gboolean on_incoming(GSocketService *svc, GSocketConnection *c, GObject *src, gpointer d) {
  (void)svc; (void)src; (void)d;
  GDataInputStream *in = g_data_input_stream_new(g_io_stream_get_input_stream(G_IO_STREAM(c)));
  gchar *line = g_data_input_stream_read_line(in, NULL, NULL, NULL);
  gboolean was_hidden = !gtk_widget_get_visible(win);
  gboolean has_url = line && *g_strstrip(line);
  if (prewarm) {
    // First show of the pre-started engine: a fresh tab (same web process) replaces the start page it
    // loaded unmapped. That view never painted once its window appeared - pages stayed blank grey until
    // a reload (desktop v12-v15) - while a view created just before the window is shown draws normally.
    WebKitWebView *old = current_view();
    add_tab(old, has_url ? line : HOME_URI, TRUE);
    if (old) gtk_notebook_remove_page(GTK_NOTEBOOK(nb), gtk_notebook_page_num(GTK_NOTEBOOK(nb), GTK_WIDGET(old)));
  } else if (has_url) add_tab(NULL, line, TRUE);
  g_free(line);
  g_object_unref(in);
  if (was_hidden) gtk_widget_show_all(win);
  if (prewarm) unlink(PREWARM_MARK);   // shown: never paused by a benchmark from now on
  prewarm = FALSE;
  gtk_window_present_with_time(GTK_WINDOW(win), GDK_CURRENT_TIME);
  return TRUE;
}

static void listen_for_launches(void) {
  unlink(SOCK_PATH);   // only the engine holding /tmp/.bbweb.lock gets here, so a leftover is stale
  GSocketService *svc = g_socket_service_new();
  GSocketAddress *a = g_unix_socket_address_new(SOCK_PATH);
  if (g_socket_listener_add_address(G_SOCKET_LISTENER(svc), a, G_SOCKET_TYPE_STREAM, G_SOCKET_PROTOCOL_DEFAULT,
                                    NULL, NULL, NULL)) {
    g_signal_connect(svc, "incoming", G_CALLBACK(on_incoming), NULL);
    g_socket_service_start(svc);
  }
  g_object_unref(a);
}

int main(int argc, char **argv) {
  log_titles = getenv("BBWEB_LOG") != NULL;
  phase("main");
  setenv("LIBGL_DRIVERS_PATH", "/nonexistent", 0);   // no Mesa: see the header
  setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1", 0);
  setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", 0);
  setenv("NO_AT_BRIDGE", "1", 0);
  for (int fd = 3; fd < 64; fd++) fcntl(fd, F_SETFD, FD_CLOEXEC);   // the launcher's lock/ready fds stay ours
  gtk_init(&argc, &argv);
  phase("gtk-init");
  g_set_prgname("bbweb");
  settings = webkit_settings_new_with_settings(
      "enable-javascript", TRUE,
      "javascript-can-open-windows-automatically", FALSE,
      "enable-smooth-scrolling", FALSE,
      "enable-webgl", FALSE,
      "enable-webaudio", FALSE,
      "enable-media-stream", FALSE,
      "media-playback-requires-user-gesture", TRUE,
      "hardware-acceleration-policy", WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER,
      "enable-back-forward-navigation-gestures", FALSE,
      "enable-site-specific-quirks", TRUE,
      "enable-dns-prefetching", TRUE,
      "default-font-size", 15,
      NULL);
  {   // no process swap on cross-site navigation: each swap = a new ~10 s WebKitWebProcess start here
    WebKitFeatureList *fl = webkit_settings_get_all_features();
    for (gsize i = 0; i < webkit_feature_list_get_length(fl); i++) {
      WebKitFeature *f = webkit_feature_list_get(fl, i);
      if (!strcmp(webkit_feature_get_identifier(f), "ProcessSwapOnCrossSiteNavigation"))
        webkit_settings_set_feature_enabled(settings, f, FALSE);
    }
    webkit_feature_list_unref(fl);
  }
  phase("settings");
  ucm = webkit_user_content_manager_new();
  if (!g_file_test(NOBLOCK_FLAG, G_FILE_TEST_EXISTS)) setup_blocker();
  WebKitWebContext *ctx = webkit_web_context_get_default();
  webkit_web_context_set_cache_model(ctx, WEBKIT_CACHE_MODEL_DOCUMENT_BROWSER);
  webkit_web_context_register_uri_scheme(ctx, "bootbox", on_bootbox_scheme, NULL, NULL);
  WebKitSecurityManager *sm = webkit_web_context_get_security_manager(ctx);
  webkit_security_manager_register_uri_scheme_as_secure(sm, "bootbox");
  webkit_security_manager_register_uri_scheme_as_cors_enabled(sm, "bootbox");
  webkit_security_manager_register_uri_scheme_as_local(sm, "bootbox");
  gboolean lite = g_file_test(LITE_FLAG, G_FILE_TEST_EXISTS);
  apply_lite(lite);

  win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_default_size(GTK_WINDOW(win), 980, 660);
  gtk_window_set_icon_from_file(GTK_WINDOW(win), "/usr/share/bootbox/icons/browser.png", NULL);
  g_signal_connect(win, "destroy", G_CALLBACK(gtk_main_quit), NULL);
  g_signal_connect(win, "delete-event", G_CALLBACK(on_delete), NULL);
  g_signal_connect(win, "key-press-event", G_CALLBACK(on_key), NULL);

  GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  GtkWidget *bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 2);
  gtk_container_set_border_width(GTK_CONTAINER(bar), 4);
  back_btn = tool_button("go-previous-symbolic", "Back (Alt+Left)", G_CALLBACK(on_back));
  fwd_btn = tool_button("go-next-symbolic", "Forward (Alt+Right)", G_CALLBACK(on_fwd));
  reload_btn = tool_button("view-refresh-symbolic", "Reload (Ctrl+R) / Stop", G_CALLBACK(on_reload));
  GtkWidget *home_btn = tool_button("go-home-symbolic", "Start page", G_CALLBACK(on_home));
  GtkWidget *tab_btn = tool_button("tab-new-symbolic", "New tab (Ctrl+T)", G_CALLBACK(on_new_tab));
  lite_btn = gtk_toggle_button_new_with_label("Lite");
  gtk_widget_set_tooltip_text(lite_btn, "Lite: mobile versions of sites, no images - much faster here");
  gtk_widget_set_can_focus(lite_btn, FALSE);
  gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(lite_btn), lite);
  g_signal_connect(lite_btn, "toggled", G_CALLBACK(on_lite_toggled), NULL);
  entry = gtk_entry_new();
  gtk_entry_set_placeholder_text(GTK_ENTRY(entry), "Search or type a web address");
  gtk_entry_set_input_purpose(GTK_ENTRY(entry), GTK_INPUT_PURPOSE_URL);
  g_signal_connect(entry, "activate", G_CALLBACK(on_entry_activate), NULL);
  gtk_box_pack_start(GTK_BOX(bar), back_btn, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(bar), fwd_btn, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(bar), reload_btn, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(bar), home_btn, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(bar), entry, TRUE, TRUE, 4);
  gtk_box_pack_start(GTK_BOX(bar), lite_btn, FALSE, FALSE, 2);
  if (access(NATIVE_FLAG, R_OK) == 0) {
    GtkWidget *fast = gtk_button_new_with_label("Fast");
    gtk_widget_set_tooltip_text(fast, "Open this page in the iPad's own browser - hundreds of times faster");
    gtk_widget_set_can_focus(fast, FALSE);
    g_signal_connect(fast, "clicked", G_CALLBACK(on_fast), NULL);
    gtk_box_pack_start(GTK_BOX(bar), fast, FALSE, FALSE, 2);
  }
  gtk_box_pack_start(GTK_BOX(bar), tab_btn, FALSE, FALSE, 0);

  nb = gtk_notebook_new();
  gtk_notebook_set_scrollable(GTK_NOTEBOOK(nb), TRUE);
  gtk_notebook_set_show_border(GTK_NOTEBOOK(nb), FALSE);
  g_signal_connect(nb, "switch-page", G_CALLBACK(on_switch_page), NULL);
  g_signal_connect(nb, "page-removed", G_CALLBACK(on_page_removed), NULL);

  gtk_box_pack_start(GTK_BOX(vbox), bar, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(vbox), nb, TRUE, TRUE, 0);
  gtk_container_add(GTK_CONTAINER(win), vbox);

  prewarm = argc > 1 && !strcmp(argv[1], "--prewarm");
  gchar *joined = argc > 1 && !prewarm ? g_strjoinv(" ", argv + 1) : NULL;
  WebKitWebView *v = add_tab(NULL, joined ? joined : HOME_URI, TRUE);
  g_free(joined);
  g_signal_connect(win, "draw", G_CALLBACK(on_first_draw), NULL);
  phase("tab-created");
  if (prewarm) { gtk_widget_show_all(vbox); gtk_widget_realize(win); }   // loads the start page, unmapped
  else gtk_widget_show_all(win);
  phase("window-shown");
  gtk_widget_grab_focus(GTK_WIDGET(v));
  listen_for_launches();
  gtk_main();
  unlink(SOCK_PATH);
  unlink(PREWARM_MARK);
  return 0;
}

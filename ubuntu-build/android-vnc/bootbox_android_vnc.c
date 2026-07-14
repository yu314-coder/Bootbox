// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Bootbox contributors

#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/input-event-codes.h>
#include <linux/uinput.h>
#include <pthread.h>
#include <rfb/keysym.h>
#include <rfb/rfb.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define DEFAULT_WIDTH 1024
#define DEFAULT_HEIGHT 768
#define HWC_MESSAGE_BYTES 64
#define HWC_SOCKET "/ipc/hwcomposer.sock"

static rfbScreenInfoPtr screen;
static int input_fd = -1;
static int display_width = DEFAULT_WIDTH;
static int display_height = DEFAULT_HEIGHT;
static int touch_active;
static int touch_tracking_id;

static void sleep_ms(long milliseconds) {
    struct timespec delay = {
        .tv_sec = milliseconds / 1000,
        .tv_nsec = (milliseconds % 1000) * 1000000L,
    };
    nanosleep(&delay, NULL);
}

static int env_int(const char *name, int fallback, int min, int max) {
    const char *value = getenv(name);
    if (!value || !*value) return fallback;
    char *end = NULL;
    long parsed = strtol(value, &end, 10);
    if (!end || *end || parsed < min || parsed > max) return fallback;
    return (int)parsed;
}

static int send_input_event(uint16_t type, uint16_t code, int32_t value) {
    if (input_fd < 0) return -1;
    struct input_event event;
    memset(&event, 0, sizeof(event));
    event.type = type;
    event.code = code;
    event.value = value;
    ssize_t written;
    do {
        written = write(input_fd, &event, sizeof(event));
    } while (written < 0 && errno == EINTR);
    return written == (ssize_t)sizeof(event) ? 0 : -1;
}

static void sync_input(void) {
    send_input_event(EV_SYN, SYN_REPORT, 0);
}

static int configure_abs(int fd, unsigned int code, int min, int max) {
    struct uinput_abs_setup setup;
    memset(&setup, 0, sizeof(setup));
    setup.code = code;
    setup.absinfo.minimum = min;
    setup.absinfo.maximum = max;
    return ioctl(fd, UI_ABS_SETUP, &setup);
}

static int expose_input_event_node(void) {
    DIR *directory = opendir("/sys/class/input");
    if (!directory) return -1;
    int result = -1;
    struct dirent *entry;
    while ((entry = readdir(directory))) {
        if (strncmp(entry->d_name, "event", 5) != 0) continue;
        char path[256];
        snprintf(path, sizeof(path), "/sys/class/input/%s/device/name", entry->d_name);
        FILE *name_file = fopen(path, "r");
        if (!name_file) continue;
        char name[128] = {0};
        fgets(name, sizeof(name), name_file);
        fclose(name_file);
        name[strcspn(name, "\r\n")] = 0;
        if (strcmp(name, "Bootbox QEMU Touchscreen") != 0) continue;

        snprintf(path, sizeof(path), "/sys/class/input/%s/dev", entry->d_name);
        FILE *dev_file = fopen(path, "r");
        unsigned int major_number = 0;
        unsigned int minor_number = 0;
        if (!dev_file || fscanf(dev_file, "%u:%u", &major_number, &minor_number) != 2) {
            if (dev_file) fclose(dev_file);
            break;
        }
        fclose(dev_file);
        mkdir("/dev/input", 0755);
        snprintf(path, sizeof(path), "/dev/input/%s", entry->d_name);
        unlink(path);
        if (mknod(path, S_IFCHR | 0666, makedev(major_number, minor_number)) == 0) {
            chown(path, 0, 1004); /* Android's input group. */
            chmod(path, 0660);
            result = 0;
        }
        break;
    }
    closedir(directory);
    return result;
}

static int open_input_device(void) {
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr, "bootbox-vnc: cannot open /dev/uinput: %s\n", strerror(errno));
        return -1;
    }

    ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT);
    ioctl(fd, UI_SET_EVBIT, EV_SYN);
    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_EVBIT, EV_ABS);
    ioctl(fd, UI_SET_EVBIT, EV_REL);
    ioctl(fd, UI_SET_RELBIT, REL_WHEEL);
    ioctl(fd, UI_SET_KEYBIT, BTN_TOUCH);
    ioctl(fd, UI_SET_KEYBIT, BTN_TOOL_FINGER);
    for (int key = 1; key <= KEY_MAX; ++key) ioctl(fd, UI_SET_KEYBIT, key);
    ioctl(fd, UI_SET_ABSBIT, ABS_X);
    ioctl(fd, UI_SET_ABSBIT, ABS_Y);
    ioctl(fd, UI_SET_ABSBIT, ABS_MT_SLOT);
    ioctl(fd, UI_SET_ABSBIT, ABS_MT_TRACKING_ID);
    ioctl(fd, UI_SET_ABSBIT, ABS_MT_POSITION_X);
    ioctl(fd, UI_SET_ABSBIT, ABS_MT_POSITION_Y);

    configure_abs(fd, ABS_X, 0, display_width - 1);
    configure_abs(fd, ABS_Y, 0, display_height - 1);
    configure_abs(fd, ABS_MT_SLOT, 0, 0);
    configure_abs(fd, ABS_MT_TRACKING_ID, 0, 65535);
    configure_abs(fd, ABS_MT_POSITION_X, 0, display_width - 1);
    configure_abs(fd, ABS_MT_POSITION_Y, 0, display_height - 1);

    struct uinput_setup setup;
    memset(&setup, 0, sizeof(setup));
    setup.id.bustype = BUS_VIRTUAL;
    setup.id.vendor = 0x18d1;
    setup.id.product = 0x4e11;
    setup.id.version = 1;
    snprintf(setup.name, UINPUT_MAX_NAME_SIZE, "Bootbox QEMU Touchscreen");
    if (ioctl(fd, UI_DEV_SETUP, &setup) < 0 || ioctl(fd, UI_DEV_CREATE) < 0) {
        fprintf(stderr, "bootbox-vnc: cannot create uinput device: %s\n", strerror(errno));
        close(fd);
        return -1;
    }

    sleep_ms(250);
    if (expose_input_event_node() < 0) {
        fprintf(stderr, "bootbox-vnc: warning: Android input node was not exposed\n");
    }
    return fd;
}

static int keysym_to_linux(rfbKeySym key) {
    if (key >= XK_a && key <= XK_z) return KEY_A + (int)(key - XK_a);
    if (key >= XK_A && key <= XK_Z) return KEY_A + (int)(key - XK_A);
    if (key >= XK_1 && key <= XK_9) return KEY_1 + (int)(key - XK_1);
    if (key == XK_0) return KEY_0;
    if (key >= XK_F1 && key <= XK_F12) return KEY_F1 + (int)(key - XK_F1);

    switch (key) {
        case XK_BackSpace: return KEY_BACKSPACE;
        case XK_Tab: return KEY_TAB;
        case XK_Return: return KEY_ENTER;
        case XK_Escape: return KEY_ESC;
        case XK_space: return KEY_SPACE;
        case XK_exclam: return KEY_1;
        case XK_quotedbl: return KEY_APOSTROPHE;
        case XK_numbersign: return KEY_3;
        case XK_dollar: return KEY_4;
        case XK_percent: return KEY_5;
        case XK_ampersand: return KEY_7;
        case XK_apostrophe: return KEY_APOSTROPHE;
        case XK_parenleft: return KEY_9;
        case XK_parenright: return KEY_0;
        case XK_asterisk: return KEY_8;
        case XK_plus: return KEY_EQUAL;
        case XK_comma: return KEY_COMMA;
        case XK_minus: return KEY_MINUS;
        case XK_period: return KEY_DOT;
        case XK_slash: return KEY_SLASH;
        case XK_colon: return KEY_SEMICOLON;
        case XK_semicolon: return KEY_SEMICOLON;
        case XK_less: return KEY_COMMA;
        case XK_equal: return KEY_EQUAL;
        case XK_greater: return KEY_DOT;
        case XK_question: return KEY_SLASH;
        case XK_at: return KEY_2;
        case XK_bracketleft: return KEY_LEFTBRACE;
        case XK_backslash: return KEY_BACKSLASH;
        case XK_bracketright: return KEY_RIGHTBRACE;
        case XK_asciicircum: return KEY_6;
        case XK_underscore: return KEY_MINUS;
        case XK_grave: return KEY_GRAVE;
        case XK_braceleft: return KEY_LEFTBRACE;
        case XK_bar: return KEY_BACKSLASH;
        case XK_braceright: return KEY_RIGHTBRACE;
        case XK_asciitilde: return KEY_GRAVE;
        case XK_Delete: return KEY_DELETE;
        case XK_Insert: return KEY_INSERT;
        case XK_Home: return KEY_HOME;
        case XK_End: return KEY_END;
        case XK_Page_Up: return KEY_PAGEUP;
        case XK_Page_Down: return KEY_PAGEDOWN;
        case XK_Left: return KEY_LEFT;
        case XK_Right: return KEY_RIGHT;
        case XK_Up: return KEY_UP;
        case XK_Down: return KEY_DOWN;
        case XK_Shift_L: return KEY_LEFTSHIFT;
        case XK_Shift_R: return KEY_RIGHTSHIFT;
        case XK_Control_L: return KEY_LEFTCTRL;
        case XK_Control_R: return KEY_RIGHTCTRL;
        case XK_Alt_L: return KEY_LEFTALT;
        case XK_Alt_R: return KEY_RIGHTALT;
        case XK_Meta_L: return KEY_LEFTMETA;
        case XK_Meta_R: return KEY_RIGHTMETA;
        case XK_Super_L: return KEY_LEFTMETA;
        case XK_Super_R: return KEY_RIGHTMETA;
        case XK_Caps_Lock: return KEY_CAPSLOCK;
        default: return -1;
    }
}

static void keyboard_event(rfbBool down, rfbKeySym key, rfbClientPtr client) {
    (void)client;
    int linux_key = keysym_to_linux(key);
    if (linux_key < 0) return;
    send_input_event(EV_KEY, (uint16_t)linux_key, down ? 1 : 0);
    sync_input();
}

static void pointer_event(int button_mask, int x, int y, rfbClientPtr client) {
    (void)client;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= display_width) x = display_width - 1;
    if (y >= display_height) y = display_height - 1;

    int pressed = button_mask & 1;
    send_input_event(EV_ABS, ABS_MT_SLOT, 0);
    if (pressed && !touch_active) {
        touch_tracking_id = (touch_tracking_id + 1) & 0xffff;
        send_input_event(EV_ABS, ABS_MT_TRACKING_ID, touch_tracking_id);
        send_input_event(EV_KEY, BTN_TOOL_FINGER, 1);
        send_input_event(EV_KEY, BTN_TOUCH, 1);
    }
    if (pressed) {
        send_input_event(EV_ABS, ABS_X, x);
        send_input_event(EV_ABS, ABS_Y, y);
        send_input_event(EV_ABS, ABS_MT_POSITION_X, x);
        send_input_event(EV_ABS, ABS_MT_POSITION_Y, y);
    } else if (touch_active) {
        send_input_event(EV_ABS, ABS_MT_TRACKING_ID, -1);
        send_input_event(EV_KEY, BTN_TOUCH, 0);
        send_input_event(EV_KEY, BTN_TOOL_FINGER, 0);
    }
    touch_active = pressed;

    if (button_mask & 8) send_input_event(EV_REL, REL_WHEEL, 1);
    if (button_mask & 16) send_input_event(EV_REL, REL_WHEEL, -1);
    sync_input();
}

static int receive_all(int fd, void *buffer, size_t size) {
    uint8_t *next = buffer;
    while (size) {
        ssize_t received = recv(fd, next, size, 0);
        if (received == 0) return -1;
        if (received < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        next += received;
        size -= (size_t)received;
    }
    return 0;
}

static int receive_shared_fd(int socket_fd) {
    char marker;
    struct iovec iov = {.iov_base = &marker, .iov_len = 1};
    char control[CMSG_SPACE(sizeof(int))];
    memset(control, 0, sizeof(control));
    struct msghdr message;
    memset(&message, 0, sizeof(message));
    message.msg_iov = &iov;
    message.msg_iovlen = 1;
    message.msg_control = control;
    message.msg_controllen = sizeof(control);

    ssize_t received;
    do {
        received = recvmsg(socket_fd, &message, 0);
    } while (received < 0 && errno == EINTR);
    if (received != 1) return -1;

    for (struct cmsghdr *header = CMSG_FIRSTHDR(&message); header;
         header = CMSG_NXTHDR(&message, header)) {
        if (header->cmsg_level == SOL_SOCKET && header->cmsg_type == SCM_RIGHTS &&
            header->cmsg_len >= CMSG_LEN(sizeof(int))) {
            int shared_fd;
            memcpy(&shared_fd, CMSG_DATA(header), sizeof(shared_fd));
            return shared_fd;
        }
    }
    return -1;
}

static int connect_hwc(void) {
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return -1;
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    snprintf(address.sun_path, sizeof(address.sun_path), "%s", HWC_SOCKET);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static void relay_frames(void) {
    const size_t frame_bytes = (size_t)display_width * display_height * 4;
    uint32_t metadata[HWC_MESSAGE_BYTES / sizeof(uint32_t)];

    for (;;) {
        int socket_fd = connect_hwc();
        if (socket_fd < 0) {
            sleep_ms(500);
            continue;
        }
        fprintf(stderr, "bootbox-vnc: connected to Android display\n");

        for (;;) {
            if (receive_all(socket_fd, metadata, sizeof(metadata)) < 0) break;
            int shared_fd = receive_shared_fd(socket_fd);
            if (shared_fd < 0) break;

            size_t map_bytes = metadata[6];
            if (map_bytes < frame_bytes || map_bytes > frame_bytes + 16 * 1024 * 1024) {
                fprintf(stderr, "bootbox-vnc: rejected framebuffer size %zu\n", map_bytes);
                close(shared_fd);
                break;
            }
            void *pixels = mmap(NULL, map_bytes, PROT_READ, MAP_SHARED, shared_fd, 0);
            if (pixels == MAP_FAILED) {
                fprintf(stderr, "bootbox-vnc: mmap failed: %s\n", strerror(errno));
                close(shared_fd);
                break;
            }
            memcpy(screen->frameBuffer, pixels, frame_bytes);
            munmap(pixels, map_bytes);
            close(shared_fd);
            rfbMarkRectAsModified(screen, 0, 0, display_width, display_height);
            if (send(socket_fd, "ok", 2, MSG_NOSIGNAL) != 2) break;
        }

        fprintf(stderr, "bootbox-vnc: display disconnected; retrying\n");
        close(socket_fd);
        sleep_ms(250);
    }
}

static void handle_signal(int signal_number) {
    (void)signal_number;
    if (input_fd >= 0) ioctl(input_fd, UI_DEV_DESTROY);
    _exit(0);
}

int main(int argc, char **argv) {
    display_width = env_int("BOOTBOX_ANDROID_WIDTH", DEFAULT_WIDTH, 320, 4096);
    display_height = env_int("BOOTBOX_ANDROID_HEIGHT", DEFAULT_HEIGHT, 240, 4096);
    int port = env_int("BOOTBOX_VNC_PORT", 5900, 1, 65535);

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    input_fd = open_input_device();
    if (input_fd < 0) return 1;

    screen = rfbGetScreen(&argc, argv, display_width, display_height, 8, 3, 4);
    if (!screen) return 1;
    screen->frameBuffer = calloc((size_t)display_width * display_height, 4);
    if (!screen->frameBuffer) return 1;
    screen->desktopName = "Bootbox Android 64-bit";
    screen->port = port;
    screen->ipv6port = port;
    screen->alwaysShared = TRUE;
    screen->deferUpdateTime = 12;
    screen->progressiveSliceHeight = 0;
    screen->kbdAddEvent = keyboard_event;
    screen->ptrAddEvent = pointer_event;

    rfbInitServer(screen);
    rfbRunEventLoop(screen, -1, TRUE);
    fprintf(stderr, "bootbox-vnc: serving %dx%d on port %d\n",
            display_width, display_height, port);
    relay_frames();
    return 0;
}

# Iosnet.xcframework source

`iosnet.go` is the source of `Frameworks/Iosnet.xcframework` — the in-app user-space network stack
(gVisor via gvisor-tap-vsock) that gives the QEMU guests real TCP/IP, bridges the guest's VNC display
(`/vnc`) and, since 1.1, the Android guest's adbd (`/adb`, used by the Android Shell pane).

It is package `iosnet` of the container2wasm module (`c2w-src/`, not tracked here). To rebuild, put it at
`c2w-src/iosnet/iosnet.go` and follow the commands at the top of the file (gomobile bind, iOS + simulator).

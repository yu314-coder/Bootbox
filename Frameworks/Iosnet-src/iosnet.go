// Rebuild the app's Frameworks/Iosnet.xcframework (Bootbox 1.1, Go 1.27, caches on /Volumes/D):
//   go install golang.org/x/mobile/cmd/gomobile@latest golang.org/x/mobile/cmd/gobind@latest
//   go get golang.org/x/mobile/bind@latest   # build-time only; not committed
//   gomobile init && gomobile bind -target=ios,iossimulator -iosversion=15.0 -o Iosnet.xcframework ./iosnet
//
// Package iosnet embeds the c2w-net gVisor user-space network stack into the iOS app so the
// QEMU-Wasm guest gets REAL TCP/IP to the internet — standalone, no external proxy/computer,
// no browser CORS, no service worker. gomobile binds this to an xcframework; the app calls
// Start() on a background thread at launch, and the guest's -netdev socket dials ws://addr/.
package iosnet

import (
	"context"
	"io"
	"log"
	"net/http"
	"sync"

	gvntypes "github.com/containers/gvisor-tap-vsock/pkg/types"
	gvnvirtualnetwork "github.com/containers/gvisor-tap-vsock/pkg/virtualnetwork"
	"golang.org/x/net/websocket"
)

var (
	mu      sync.Mutex
	running bool
)

// Start launches the netstack and serves it over a WebSocket at listenAddr (e.g.
// "127.0.0.1:8889"). It blocks serving requests, so call it on a background thread.
// Idempotent: a second call while already running returns nil immediately.
// The config mirrors cmd/c2w-net (gateway .1, VM .3 via DHCP static lease, NAT to host).
func Start(listenAddr string) error {
	mu.Lock()
	if running {
		mu.Unlock()
		return nil
	}
	running = true
	mu.Unlock()

	config := &gvntypes.Configuration{
		Debug:             false,
		MTU:               1500,
		Subnet:            "192.168.127.0/24",
		GatewayIP:         "192.168.127.1",
		GatewayMacAddress: "5a:94:ef:e4:0c:dd",
		DHCPStaticLeases: map[string]string{
			"192.168.127.3": "02:00:00:00:00:01",
		},
		NAT: map[string]string{
			"192.168.127.254": "127.0.0.1",
		},
		GatewayVirtualIPs: []string{"192.168.127.254"},
		Protocol:          gvntypes.QemuProtocol,
	}
	vn, err := gvnvirtualnetwork.New(config)
	if err != nil {
		mu.Lock()
		running = false
		mu.Unlock()
		return err
	}
	mux := http.NewServeMux()
	// GUI VNC bridge: noVNC connects to ws://<addr>/vnc; we dial INTO the guest's Xvnc (tigervnc's
	// X+VNC server, listening on its eth0 192.168.127.3:5900) through the netstack and pump RFB both
	// ways. Xvnc listens cleanly and instantly (unlike x11vnc, which blocked forever on XGetImage
	// round-trips under TCG and never bound), so the simple inbound vn.Dial works.
	mux.Handle("/vnc", websocket.Handler(func(ws *websocket.Conn) {
		ws.PayloadType = websocket.BinaryFrame
		log.Printf("[vnc] noVNC connected; dialing guest Xvnc 192.168.127.3:5900")
		tcp, err := vn.Dial("tcp", "192.168.127.3:5900")
		if err != nil {
			log.Printf("[vnc] dial FAILED (Xvnc unreachable): %v", err)
			return
		}
		log.Printf("[vnc] bridging noVNC <-> Xvnc")
		defer tcp.Close()
		done := make(chan struct{}, 2)
		go func() {
			n, e := io.Copy(tcp, ws)
			log.Printf("[vnc] noVNC->guest closed: %d (%v)", n, e)
			done <- struct{}{}
		}()
		go func() {
			n, e := io.Copy(ws, tcp)
			log.Printf("[vnc] guest->noVNC closed: %d (%v)", n, e)
			done <- struct{}{}
		}()
		<-done
	}))
	// Android shell bridge (Bootbox 1.1): the app's Android "Shell" pane speaks the adb wire protocol
	// over ws://<addr>/adb to the guest's adbd (192.168.127.3:5555, ro.adb.secure=0 in the image), so
	// a terminal works even while Android's own UI is busy - the text is drawn by the iPad, not the guest.
	// Fixed guest address and port only: this is not a general-purpose tunnel.
	mux.Handle("/adb", websocket.Handler(func(ws *websocket.Conn) {
		ws.PayloadType = websocket.BinaryFrame
		log.Printf("[adb] shell client connected; dialing guest adbd 192.168.127.3:5555")
		tcp, err := vn.Dial("tcp", "192.168.127.3:5555")
		if err != nil {
			log.Printf("[adb] dial FAILED (adbd unreachable): %v", err)
			return
		}
		defer tcp.Close()
		done := make(chan struct{}, 2)
		go func() { io.Copy(tcp, ws); done <- struct{}{} }()
		go func() { io.Copy(ws, tcp); done <- struct{}{} }()
		<-done
	}))
	mux.Handle("/", websocket.Handler(func(ws *websocket.Conn) {
		ws.PayloadType = websocket.BinaryFrame
		_ = vn.AcceptQemu(context.TODO(), ws)
	}))
	srv := &http.Server{Addr: listenAddr, Handler: mux}
	err = srv.ListenAndServe()
	mu.Lock()
	running = false
	mu.Unlock()
	return err
}

// capnet: the Bootbox app netstack (Frameworks/Iosnet-src config) for native snapshot captures - QEMU's
// `-netdev socket,connect=127.0.0.1:8899` instead of slirp (slirp adds a savevm section the app engine lacks),
// so the guest gets the app's DHCP identity (192.168.127.3) and the snapshot resumes in the app.
// Forwards 127.0.0.1:6555 -> guest adbd 5555 and 127.0.0.1:6900 -> guest VNC 5900.
package main

import (
	"context"
	"io"
	"log"
	"net"

	gvntypes "github.com/containers/gvisor-tap-vsock/pkg/types"
	gvnvirtualnetwork "github.com/containers/gvisor-tap-vsock/pkg/virtualnetwork"
)

func forward(vn *gvnvirtualnetwork.VirtualNetwork, listen, guest string) {
	l, err := net.Listen("tcp", listen)
	if err != nil {
		log.Fatal(err)
	}
	for {
		c, err := l.Accept()
		if err != nil {
			continue
		}
		go func(c net.Conn) {
			defer c.Close()
			g, err := vn.Dial("tcp", guest)
			if err != nil {
				return
			}
			defer g.Close()
			go io.Copy(g, c)
			io.Copy(c, g)
		}(c)
	}
}

func main() {
	config := &gvntypes.Configuration{
		MTU:               1500,
		Subnet:            "192.168.127.0/24",
		GatewayIP:         "192.168.127.1",
		GatewayMacAddress: "5a:94:ef:e4:0c:dd",
		DHCPStaticLeases:  map[string]string{"192.168.127.3": "02:00:00:00:00:01"},
		NAT:               map[string]string{"192.168.127.254": "127.0.0.1"},
		GatewayVirtualIPs: []string{"192.168.127.254"},
		Protocol:          gvntypes.QemuProtocol,
	}
	vn, err := gvnvirtualnetwork.New(config)
	if err != nil {
		log.Fatal(err)
	}
	go forward(vn, "127.0.0.1:6555", "192.168.127.3:5555")
	go forward(vn, "127.0.0.1:6900", "192.168.127.3:5900")
	l, err := net.Listen("tcp", "127.0.0.1:8899")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("capnet: qemu socket on 127.0.0.1:8899")
	for {
		c, err := l.Accept()
		if err != nil {
			continue
		}
		go func() {
			if err := vn.AcceptQemu(context.Background(), c); err != nil {
				log.Printf("qemu connection: %v", err)
			}
		}()
	}
}

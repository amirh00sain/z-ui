// Command grpcsmoke 是 v0.4.5 gRPC 用户增删的真节点冒烟工具。
//
// 不依赖运行中的面板，直接用显式 SSH 参数连节点 → SSH 隧道 dial 127.0.0.1:10085 →
// 调用与 livesync 相同的 xray.AddUser / xray.RemoveUser，验证 AlterInbound + type URL
// 在真节点真生效。这是合并 v0.4.5 到主线前的命门验证。
//
// 用法（默认 roundtrip：加一个临时测试用户再删掉，不影响真实用户）：
//
//	go run ./cmd/grpcsmoke -host 1.2.3.4 -key ~/.ssh/id_ed25519 -tag vless-reality-3 -proto vless-reality
//
// inbound tag 可从面板「节点协议管理 → 查看完整配置」里读到（形如 vless-reality-{profileID}）。
//
// 验证要点：
//  1. 命令打印每步成功；
//  2. 操作前后在节点上跑 `systemctl show -p ActiveEnterTimestamp xray`，时间戳不变
//     → 证明用户增删未重启 xray（v0.4.5 的核心价值）。
//
// 该工具为开发/运维冒烟用，合并前可保留为 ops 工具或删除。
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"

	"github.com/imrui/xray-pilot/internal/xray"
	xssh "github.com/imrui/xray-pilot/pkg/ssh"
)

func main() {
	host := flag.String("host", "", "Node IP (SSH connection, required)")
	sshPort := flag.Int("port", 22, "SSH port")
	sshUser := flag.String("user", "root", "SSH user")
	keyPath := flag.String("key", "", "SSH private key path")
	knownHosts := flag.String("known-hosts", "", "known_hosts path (blank uses the ssh package default)")
	tag := flag.String("tag", "", "inbound tag, e.g. vless-reality-3 (required)")
	proto := flag.String("proto", "vless-reality", "protocol: vless-reality|vless-ws-tls|trojan")
	op := flag.String("op", "roundtrip", "op: roundtrip(add then remove) | add | remove")
	email := flag.String("email", "", "user email (username); blank generates a temporary test name smoketest-<ts>")
	uuid := flag.String("uuid", "", "user UUID (required for add/roundtrip; blank falls back to the timestamp)")
	flag.Parse()

	if *host == "" || *tag == "" {
		fmt.Fprintln(os.Stderr, "error: -host and -tag are required")
		flag.Usage()
		os.Exit(2)
	}

	ts := time.Now().Unix()
	if *email == "" {
		*email = fmt.Sprintf("smoketest-%d", ts)
	}
	if *uuid == "" {
		*uuid = fmt.Sprintf("00000000-0000-4000-8000-%012d", ts%1e12)
	}

	fmt.Printf("connecting to node %s:%d (user=%s)...\n", *host, *sshPort, *sshUser)
	client, err := xssh.Connect(xssh.Config{
		Host:           *host,
		Port:           *sshPort,
		User:           *sshUser,
		KeyPath:        *keyPath,
		KnownHostsPath: *knownHosts,
	})
	if err != nil {
		fatal("SSH connection failed", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fmt.Printf("dialing gRPC over the SSH tunnel %s...\n", xray.GRPCAPIAddress)
	conn, err := client.DialGRPC(ctx, xray.GRPCAPIAddress)
	if err != nil {
		fatal("gRPC dial failed (check that the node xray has the API inbound on 10085 and is running)", err)
	}
	defer conn.Close()

	switch *op {
	case "add":
		doAdd(ctx, conn, *tag, *proto, *email, *uuid)
	case "remove":
		doRemove(ctx, conn, *tag, *email)
	case "roundtrip":
		doAdd(ctx, conn, *tag, *proto, *email, *uuid)
		doRemove(ctx, conn, *tag, *email)
	default:
		fatal("unknown -op", fmt.Errorf("%q (expected roundtrip|add|remove)", *op))
	}

	fmt.Println("\n✅ Smoke test done. Confirm on the node that xray was not restarted:")
	fmt.Println("   systemctl show -p ActiveEnterTimestamp xray   # the timestamp should be unchanged")
}

func doAdd(ctx context.Context, conn *grpc.ClientConn, tag, proto, email, uuid string) {
	account, err := xray.BuildAccountForProtocol(proto, uuid)
	if err != nil {
		fatal("failed to build the account", err)
	}
	start := time.Now()
	if err := xray.AddUser(ctx, conn, tag, email, account); err != nil {
		fatal("AddUser failed", err)
	}
	fmt.Printf("  ✓ AddUser(tag=%s, email=%s, proto=%s) ok (%dms)\n", tag, email, proto, time.Since(start).Milliseconds())
}

func doRemove(ctx context.Context, conn *grpc.ClientConn, tag, email string) {
	start := time.Now()
	if err := xray.RemoveUser(ctx, conn, tag, email); err != nil {
		fatal("RemoveUser failed", err)
	}
	fmt.Printf("  ✓ RemoveUser(tag=%s, email=%s) ok (%dms)\n", tag, email, time.Since(start).Milliseconds())
}

func fatal(msg string, err error) {
	fmt.Fprintf(os.Stderr, "\n❌ %s: %v\n", msg, err)
	os.Exit(1)
}

//go:build darwin && cgo

package localserver

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <bsm/audit.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

static SecRequirementRef lightos_client_requirement(void) {
	SecCodeRef self = NULL;
	if (SecCodeCopySelf(kSecCSDefaultFlags, &self) != errSecSuccess) return NULL;
	SecStaticCodeRef staticSelf = NULL;
	OSStatus status = SecCodeCopyStaticCode(self, kSecCSDefaultFlags, &staticSelf);
	CFRelease(self);
	if (status != errSecSuccess || !staticSelf) return NULL;
	CFDictionaryRef signing = NULL;
	status = SecCodeCopySigningInformation(staticSelf, kSecCSSigningInformation, &signing);
	CFRelease(staticSelf);
	if (status != errSecSuccess || !signing) return NULL;
	CFStringRef team = CFDictionaryGetValue(signing, kSecCodeInfoTeamIdentifier);
	CFStringRef text = NULL;
	if (team && CFGetTypeID(team) == CFStringGetTypeID() && CFStringGetLength(team) == 10) {
		char value[11];
		if (CFStringGetCString(team, value, sizeof(value), kCFStringEncodingASCII) && strspn(value, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") == 10) {
			text = CFStringCreateWithFormat(NULL, NULL, CFSTR("anchor apple generic and certificate leaf[subject.OU] = \"%@\" and identifier \"cloud.lazycat.app.lightos\""), team);
		}
	}
	CFRelease(signing);
	if (!text) return NULL;
	SecRequirementRef requirement = NULL;
	SecRequirementCreateWithString(text, kSecCSDefaultFlags, &requirement);
	CFRelease(text);
	return requirement;
}

static int lightos_client_peer(int fd) {
	uid_t uid;
	gid_t gid;
	if (getpeereid(fd, &uid, &gid) != 0 || uid != geteuid()) return 0;
	audit_token_t token;
	socklen_t size = sizeof(token);
	if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) != 0 || size != sizeof(token)) return 0;
	CFDataRef audit = CFDataCreate(NULL, (const UInt8 *)&token, sizeof(token));
	if (!audit) return 0;
	const void *keys[] = {kSecGuestAttributeAudit};
	const void *values[] = {audit};
	CFDictionaryRef attributes = CFDictionaryCreate(NULL, keys, values, 1,
		&kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	CFRelease(audit);
	if (!attributes) return 0;
	SecCodeRef code = NULL;
	OSStatus status = SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, &code);
	CFRelease(attributes);
	if (status != errSecSuccess || !code) return 0;
	SecRequirementRef requirement = lightos_client_requirement();
	status = requirement ? SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement) : errSecCSReqFailed;
	if (requirement) CFRelease(requirement);
	CFRelease(code);
	return status == errSecSuccess;
}
*/
import "C"

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"lcmd-webshell/core"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// The discoverable path identifies a rendezvous only. Both peers authenticate the
// kernel-provided audit token before any terminal frames cross the connection.
func (s *Server) startLocalTerminal() {
	if !s.config.GRPCTransport || s.config.AdmissionAllowed == nil || os.Geteuid() == 0 {
		return
	}
	var directory [1024]C.char
	if length := C.confstr(C._CS_DARWIN_USER_TEMP_DIR, &directory[0], C.size_t(len(directory))); length == 0 || int(length) > len(directory) {
		return
	}
	dir := C.GoString(&directory[0])
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return
	}
	digest := sha256.Sum256([]byte(s.config.InstanceID))
	address := filepath.Join(dir, "lightos-tty."+hex.EncodeToString(digest[:12])+".sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: address, Net: "unix"})
	if err != nil {
		return
	}
	if err := os.Chmod(address, 0600); err != nil {
		listener.Close()
		return
	}
	context.AfterFunc(s.ctx, func() { listener.Close() })
	go func() {
		slots := make(chan struct{}, 16)
		for {
			conn, err := listener.AcceptUnix()
			if err != nil {
				return
			}
			select {
			case slots <- struct{}{}:
				go func() {
					defer func() { <-slots }()
					s.handleLocalTerminal(conn)
				}()
			default:
				conn.Close()
			}
		}
	}()
}

type localTerminalRequest struct {
	Version    int    `json:"version"`
	InstanceID string `json:"instance_id"`
	AccountID  string `json:"account_id"`
	BoxID      string `json:"box_id"`
}

func (s *Server) handleLocalTerminal(conn *net.UnixConn) {
	defer conn.Close()
	if !s.config.AdmissionAllowed() {
		return
	}
	raw, err := conn.SyscallConn()
	if err != nil {
		return
	}
	var trusted bool
	if err := raw.Control(func(fd uintptr) { trusted = C.lightos_client_peer(C.int(fd)) != 0 }); err != nil || !trusted {
		return
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	kind, payload, err := readLocalFrame(conn, 4096)
	var request localTerminalRequest
	if err != nil || kind != 1 || json.Unmarshal(payload, &request) != nil || request.Version != 1 ||
		request.InstanceID != s.config.InstanceID || request.AccountID != s.config.AccountID || request.BoxID != s.config.BoxID ||
		!s.config.AdmissionAllowed() || s.ctx.Err() != nil {
		return
	}

	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	// Pause ends this attachment without ending the shared PTY.
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !s.config.AdmissionAllowed() {
					cancel()
					return
				}
			}
		}
	}()
	var mu sync.Mutex
	write := func(kind int, data []byte) error {
		mu.Lock()
		defer mu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		var header [5]byte
		header[0] = byte(kind)
		binary.BigEndian.PutUint32(header[1:], uint32(len(data)))
		buffers := net.Buffers{header[:], data}
		_, err := buffers.WriteTo(conn)
		return err
	}
	s.serveQueue(ctx, write, func() (int, []byte, error) {
		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		kind, data, err := readLocalFrame(conn, core.WebsocketReadLimit)
		if !s.config.AdmissionAllowed() || ctx.Err() != nil {
			return 0, nil, context.Canceled
		}
		return kind, data, err
	}, 0)
}

func readLocalFrame(reader io.Reader, max uint32) (int, []byte, error) {
	var header [5]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	size := binary.BigEndian.Uint32(header[1:])
	if header[0] != 1 || size > max {
		return 0, nil, errors.New("invalid local terminal message")
	}
	data := make([]byte, size)
	_, err := io.ReadFull(reader, data)
	return int(header[0]), data, err
}

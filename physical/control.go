// Package physical defines the private service-side native-target control API.
package physical

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"lcmd-webshell/execution"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const OwnerHeader = "X-Physical-Owner"

func ControlSocket() string {
	if p := os.Getenv("LIGHTOS_EXECUTION_CONTROL_SOCKET"); p != "" {
		return p
	}
	return "/lzcapp/var/lightos/execution/control.sock"
}
func ServiceSocket() string {
	if p := os.Getenv("LIGHTOS_PHYSICAL_SOCKET"); p != "" {
		return p
	}
	return "/lzcapp/var/lightos/execution/webshell.sock"
}
func StateDir() string {
	if p := os.Getenv("LIGHTOS_PHYSICAL_STATE_DIR"); p != "" {
		return p
	}
	return filepath.Join(filepath.Dir(ServiceSocket()), "state")
}
func HTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", ServiceSocket())
	}}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func DialContext(ctx context.Context, _, _ string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "unix", ServiceSocket())
}

type AccessRequest struct {
	LeaseOnly  bool   `json:"lease_only,omitempty"`
	Owner      string `json:"owner"`
	Instance   string `json:"instance"`
	Epoch      string `json:"execution_epoch"`
	Controller string `json:"controller_generation"`
}
type AccessRecord struct {
	Access     execution.Access `json:"access"`
	Secret     string           `json:"secret"`
	Instance   string           `json:"instance"`
	ValidUntil time.Time        `json:"valid_until"`
}
type AccessError struct{ Status int }

func (e AccessError) Error() string {
	if e.Status == 426 {
		return "update the physical client"
	}
	if e.Status == 403 {
		return "physical access revoked"
	}
	return "physical access unavailable"
}
func Access(ctx context.Context, q AccessRequest) (AccessRecord, error) {
	raw, _ := json.Marshal(q)
	request, err := http.NewRequestWithContext(ctx, "POST", "http://control/access", bytes.NewReader(raw))
	if err != nil {
		return AccessRecord{}, err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", ControlSocket())
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 20 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return AccessRecord{}, errors.New("execution issuer unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return AccessRecord{}, AccessError{response.StatusCode}
	}
	var result AccessRecord
	if err = json.NewDecoder(http.MaxBytesReader(nil, response.Body, 64<<10)).Decode(&result); err != nil {
		return AccessRecord{}, errors.New("invalid execution access response")
	}
	return result, nil
}

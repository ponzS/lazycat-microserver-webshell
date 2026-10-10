package main

import (
	"context"
	"encoding/json"
	"golang.org/x/crypto/ssh"
	"io"
	"lcmd-webshell/execution"
)

type hostSigner struct {
	backend *execution.Backend
	public  ssh.PublicKey
}

func newHostSigner(backend *execution.Backend) (ssh.Signer, error) {
	raw, err := backend.HostPublicKey(context.Background())
	if err != nil {
		return nil, err
	}
	public, err := ssh.ParsePublicKey(raw)
	if err != nil {
		return nil, err
	}
	return &hostSigner{backend, public}, nil
}
func (s *hostSigner) PublicKey() ssh.PublicKey { return s.public }
func (s *hostSigner) Sign(_ io.Reader, data []byte) (*ssh.Signature, error) {
	raw, err := s.backend.SignHost(context.Background(), data)
	if err != nil {
		return nil, err
	}
	var signature ssh.Signature
	err = json.Unmarshal(raw, &signature)
	return &signature, err
}

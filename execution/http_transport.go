package execution

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// HTTP requests use the existing target file service over a connection-owned
// private stream. File contents are never buffered as one protocol response.
func (b *Backend) fileHTTP(ctx context.Context, method, path string, body io.Reader, header http.Header) (*http.Response, error) {
	key := "file-http-" + randomID()
	p, err := b.openTransient(ctx, key, Request{Op: "open_http", Key: key, ConnectionBound: true})
	if err != nil {
		return nil, err
	}
	command := b.command(ctx, p)
	go io.Copy(io.Discard, command.Errors())
	request, err := http.NewRequestWithContext(ctx, method, "http://target"+path, body)
	if err != nil {
		command.Terminate()
		return nil, err
	}
	request.Header = header.Clone()
	request.Close = true
	go func() {
		input := command.Input()
		err := request.Write(input)
		_ = input.Close()
		if err != nil {
			command.Terminate()
		}
	}()
	response, err := http.ReadResponse(bufio.NewReader(command.Output()), request)
	if err != nil {
		command.Terminate()
		return nil, err
	}
	response.Body = &fileHTTPBody{ReadCloser: response.Body, command: command}
	return response, nil
}

type fileHTTPBody struct {
	io.ReadCloser
	command *Command
	once    sync.Once
}

func (b *fileHTTPBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(func() { _ = b.command.Terminate() })
	return err
}
func fileServicePath(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	return "/s/files/" + strings.TrimLeft((&url.URL{Path: path}).EscapedPath(), "/")
}
func (b *Backend) putFile(ctx context.Context, path string, body io.Reader) error {
	response, err := b.fileHTTP(ctx, http.MethodPut, fileServicePath(path), body, http.Header{})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("target file upload failed")
	}
	return nil
}

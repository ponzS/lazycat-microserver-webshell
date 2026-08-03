//go:build !linux

package main

func reconcileAgentDaemons(socketPath, selector, accountID string) (int, error) {
	return 0, nil
}

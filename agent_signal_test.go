package main

import (
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"testing"
)

func TestResetAgentDaemonSignalDispositionRestoresChildSIGINT(t *testing.T) {
	if os.Getenv("LCMD_WEBSHELL_SIGNAL_HELPER") == "1" {
		signal.Ignore(syscall.SIGINT)
		if err := resetAgentDaemonSignalDisposition(); err != nil {
			t.Fatalf("resetAgentDaemonSignalDisposition() returned error: %v", err)
		}
		output, err := exec.Command("python3", "-c", "import signal; print(signal.getsignal(signal.SIGINT))").CombinedOutput()
		if err != nil {
			t.Fatalf("python signal probe returned error: %v, output: %s", err, output)
		}
		if strings.TrimSpace(string(output)) == "1" {
			t.Fatalf("child still inherited ignored SIGINT: %s", output)
		}
		return
	}

	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 is required for signal inheritance probe")
	}
	command := exec.Command(os.Args[0], "-test.run=TestResetAgentDaemonSignalDispositionRestoresChildSIGINT")
	command.Env = append(os.Environ(), "LCMD_WEBSHELL_SIGNAL_HELPER=1")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("signal helper returned error: %v, output: %s", err, output)
	}
}

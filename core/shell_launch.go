package core

import (
	"path"
	"strings"
)

// ShellArguments is shared by local and remote physical terminals. Container
// user switching and bootstrap scripts keep their original platform path.
func ShellArguments(program, targetOS, command string, execute, nonInteractive bool) []string {
	if targetOS == "windows" {
		args := []string{"-NoLogo", "-NoExit", "-Command", "[Console]::InputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); chcp 65001 > $null; $global:LightOSTerminalOriginalPrompt=$function:prompt; function global:prompt { $promptText = & $global:LightOSTerminalOriginalPrompt; [Console]::Write([char]27+']777;webshell-cwd='+[Uri]::EscapeDataString($ExecutionContext.SessionState.Path.CurrentFileSystemLocation.Path)+[char]7); $promptText }"}
		if execute {
			args = []string{"-NoLogo", "-Command", "[Console]::InputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $OutputEncoding=[Text.UTF8Encoding]::new(); " + command}
		}
		if nonInteractive {
			args = append([]string{"-NonInteractive"}, args...)
		}
		return args
	}
	if execute {
		return []string{"-c", command}
	}
	args := []string{"-i"}
	if targetOS == "darwin" {
		args = []string{"-il"}
	}
	if path.Base(program) == "fish" {
		args = []string{"--interactive"}
		if targetOS == "darwin" {
			args = append(args, "--login")
		}
	}
	return args
}

func ShellLocale(targetOS string, getenv func(string) string) map[string]string {
	locale := "C.UTF-8"
	if targetOS == "darwin" {
		locale = "en_US.UTF-8"
	}
	utf8 := func(value string) bool {
		value = strings.ToUpper(value)
		return strings.Contains(value, "UTF-8") || strings.Contains(value, "UTF8")
	}
	for _, key := range []string{"LC_ALL", "LC_CTYPE", "LANG"} {
		if value := getenv(key); utf8(value) {
			locale = value
			break
		}
	}
	result := map[string]string{}
	for _, key := range []string{"LANG", "LC_ALL", "LC_CTYPE"} {
		if !utf8(getenv(key)) {
			result[key] = locale
		}
	}
	return result
}

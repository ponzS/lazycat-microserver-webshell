module lcmd-webshell/physicalserver

go 1.26.0

require (
	golang.org/x/crypto v0.57.0
	golang.org/x/sys v0.48.0
	lcmd-webshell v0.0.0
	lcmd-webshell/sshserver v0.0.0
)

require (
	github.com/google/shlex v0.0.0-20191202100458-e7afc7fbc510 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/kr/fs v0.1.0 // indirect
	github.com/pkg/sftp v1.13.10 // indirect
	github.com/tetratelabs/wazero v1.10.1 // indirect
	golang.org/x/image v0.36.0 // indirect
	golang.org/x/text v0.42.0 // indirect
)

replace lcmd-webshell => ..

replace lcmd-webshell/sshserver => ../sshserver

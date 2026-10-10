# Physical service control

Private Unix-socket contract between an authenticated target owner, the device authorization issuer and the independently built terminal service. Socket paths are configured through `LIGHTOS_EXECUTION_CONTROL_SOCKET` and `LIGHTOS_PHYSICAL_SOCKET`. Directories and sockets must be restricted to the service user and excluded from target mounts and public HTTP routing.

`POST /access` validates owner, instance, enablement epoch and current device discovery. Its short-lived result is server-only. The terminal service does not retain browser cookies, fabricate user headers, or select a client-reported URL.

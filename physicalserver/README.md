# Physical terminal service

Independent native-target service that reuses Core, Unified, file and SSH behavior. It communicates with the execution target through the versioned device protocol and serves trusted callers through a private Unix socket. It never executes target commands on the service host.

Build this module with Go 1.26 or newer. The container provider and its agent keep their own module and build toolchain. Persist state in a private directory configured through `LIGHTOS_PHYSICAL_STATE_DIR`; exclude it from public routes and target files.

Run with the authorization issuer socket available. Verify authenticated browser terminals, SSH, files, target-side forwarding, explicit revocation and recovery after forced service replacement with real devices before release.

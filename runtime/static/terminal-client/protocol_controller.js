import { createTerminalSessionProtocolController } from "../terminal/transport/session_protocol_controller.js";
import { createClientTerminalSessionProtocol } from "./session_protocol.js";

// Client protocol entry point. Reuse socket lifecycle/rendering machinery,
// but install client compatibility behavior only on this controller instance.
// The container controller never receives this adapter.
export function createClientTerminalProtocolController({
  history,
  isClientTarget,
  ...options
} = {}) {
  const protocol = createClientTerminalSessionProtocol({
    isClientTarget,
    history,
    output: options.terminalOutput,
    resize: options.terminalResize,
    resetTerminalForHistoryReplay: options.resetTerminalForHistoryReplay,
  });
  return createTerminalSessionProtocolController({
    ...options,
    resolveSessionProtocol: protocol.forSession,
  });
}

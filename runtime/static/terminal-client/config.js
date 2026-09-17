// Existing client direct-connection and browser history defaults.
export const CLIENT_TERMINAL_CONFIG = Object.freeze({
  terminalClientDirectWebSocketCapacity: 3,
  terminalConnectionInteractionPriorityMs: 1200,
  terminalHistoryCacheFlushBytes: 256 * 1024,
  terminalHistoryCacheFlushDelayMs: 50,
  terminalHistoryCacheOrphanTTL: 30 * 1000,
  averageTerminalHistoryBytesPerLine: 350,
});

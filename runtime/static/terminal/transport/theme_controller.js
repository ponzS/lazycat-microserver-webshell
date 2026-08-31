/**
 * Sends the current terminal theme over an already-open session socket.
 * Theme state belongs to appearance; this adapter only validates the socket
 * and serializes the protocol payload.
 */
export function createTerminalThemeController({
  getThemePayload = () => ({}),
  socketOpen = 1,
} = {}) {
  let disposed = false;
  let generation = 0;

  const send = (session) => {
    if (disposed || session?.socket?.readyState !== socketOpen) {
      return false;
    }
    session.socket.send(JSON.stringify({
      type: "theme",
      ...getThemePayload(),
    }));
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    generation += 1;
    return true;
  };

  return Object.freeze({
    dispose,
    generation: () => generation,
    isDisposed: () => disposed,
    send,
  });
}

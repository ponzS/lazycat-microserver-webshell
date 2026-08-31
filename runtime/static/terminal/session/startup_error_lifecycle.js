export function createTerminalStartupErrorLifecycle() {
  const requestIDs = new WeakMap();
  let disposed = false;

  const nextRequest = (session) => {
    if (disposed || !session) {
      return 0;
    }
    const requestID = Number(requestIDs.get(session) || session.startupErrorRequestID || 0) + 1;
    requestIDs.set(session, requestID);
    session.startupErrorRequestID = requestID;
    return requestID;
  };

  const isCurrent = (session, requestID) => (
    !disposed
    && Boolean(session)
    && Number(requestIDs.get(session) || session.startupErrorRequestID || 0) === Number(requestID || 0)
  );

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({
    dispose,
    isCurrent,
    isDisposed: () => disposed,
    nextRequest,
  });
}

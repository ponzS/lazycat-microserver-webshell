export function createTerminalCacheAsync({
  windowObject = globalThis.window,
} = {}) {
  const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = windowObject?.setTimeout?.(() => {
      if (!settled) {
        settled = true;
        reject(new Error(message));
      }
    }, timeoutMs);
    Promise.resolve(promise).then((value) => {
      if (!settled) {
        settled = true;
        windowObject?.clearTimeout?.(timer);
        resolve(value);
      }
    }, (error) => {
      if (!settled) {
        settled = true;
        windowObject?.clearTimeout?.(timer);
        reject(error);
      }
    });
  });

  const withProgressTimeout = (operation, timeoutMs, message) => new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const arm = () => {
      if (settled) {
        throw new Error(message);
      }
      if (timer) {
        windowObject?.clearTimeout?.(timer);
      }
      timer = windowObject?.setTimeout?.(() => {
        if (!settled) {
          settled = true;
          reject(new Error(message));
        }
      }, timeoutMs);
    };
    arm();
    Promise.resolve().then(() => operation(arm)).then((value) => {
      if (!settled) {
        settled = true;
        windowObject?.clearTimeout?.(timer);
        resolve(value);
      }
    }, (error) => {
      if (!settled) {
        settled = true;
        windowObject?.clearTimeout?.(timer);
        reject(error);
      }
    });
  });

  return Object.freeze({ withProgressTimeout, withTimeout });
}

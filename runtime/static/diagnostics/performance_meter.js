export function createPerformanceMeter({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  container = null,
  sampleMs = 500,
  warmupFrames = 12,
} = {}) {
  let meter = null;
  let fps = null;
  let refresh = null;
  let frame = 0;
  let active = false;
  let disposed = false;

  const mount = () => {
    if (meter?.isConnected || !container || !documentObject) {
      return;
    }
    meter = documentObject.createElement("div");
    meter.className = "fps-meter";
    meter.id = "performanceMeter";
    meter.setAttribute("aria-live", "off");

    fps = documentObject.createElement("span");
    fps.id = "performanceMeterFps";
    fps.textContent = "-- FPS";

    refresh = documentObject.createElement("span");
    refresh.id = "performanceMeterRefresh";
    refresh.textContent = "-- Hz";
    meter.append(fps, refresh);
    container.appendChild(meter);
  };

  const stop = () => {
    if (frame) {
      windowObject?.cancelAnimationFrame?.(frame);
      frame = 0;
    }
  };

  const unmount = () => {
    meter?.remove();
    meter = null;
    fps = null;
    refresh = null;
  };

  const start = () => {
    if (!active || disposed || !fps || !refresh || frame || typeof windowObject?.requestAnimationFrame !== "function") {
      return;
    }
    let frameCount = 0;
    let sampleFrames = 0;
    let sampleStart = 0;
    let lastTime = 0;
    const frameIntervals = [];
    const maxIntervals = 90;
    const update = (time) => {
      if (!active || disposed) {
        frame = 0;
        return;
      }
      frameCount += 1;
      if (lastTime > 0) {
        const interval = time - lastTime;
        if (interval > 0 && interval < 1000) {
          frameIntervals.push(interval);
          if (frameIntervals.length > maxIntervals) {
            frameIntervals.shift();
          }
        }
      }
      lastTime = time;
      if (frameCount <= Math.max(0, Number(warmupFrames) || 0)) {
        sampleStart = time;
        sampleFrames = 0;
        frame = windowObject.requestAnimationFrame(update);
        return;
      }
      if (!sampleStart) {
        sampleStart = time;
      }
      sampleFrames += 1;
      const elapsed = time - sampleStart;
      if (elapsed >= Math.max(100, Number(sampleMs) || 500)) {
        const nextFPS = Math.round((sampleFrames * 1000) / elapsed);
        const intervals = frameIntervals.slice().sort((left, right) => left - right);
        const median = intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : 0;
        const nextRefresh = median > 0 ? Math.round(1000 / median) : 0;
        fps.textContent = `${nextFPS} FPS`;
        refresh.textContent = nextRefresh > 0 ? `${nextRefresh} Hz` : "-- Hz";
        sampleStart = time;
        sampleFrames = 0;
      }
      frame = windowObject.requestAnimationFrame(update);
    };
    frame = windowObject.requestAnimationFrame(update);
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      active = false;
      stop();
      unmount();
    },
    setActive(nextActive) {
      active = nextActive === true && !disposed;
      if (active) {
        mount();
        start();
      } else {
        stop();
        unmount();
      }
    },
  };
}

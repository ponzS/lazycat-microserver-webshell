export function createTerminalCachePreviewView({
  URLObject = globalThis.URL,
  ImageCtor = globalThis.Image,
  HTMLCanvasElementCtor = globalThis.HTMLCanvasElement,
} = {}) {
  const isCanvas = (value) => Boolean(
    HTMLCanvasElementCtor
    && value instanceof HTMLCanvasElementCtor
  );

  const clearPrepared = (session) => {
    if (!session) {
      return false;
    }
    session.cacheV2PreviewPrepareSeq = Number(session.cacheV2PreviewPrepareSeq || 0) + 1;
    session.cacheV2PreviewAuthorizedSnapshot = null;
    const prepared = session.cacheV2PreparedPreview;
    session.cacheV2PreparedPreview = null;
    session.cacheV2PreviewPreparePromise = null;
    if (prepared?.objectURL) {
      URLObject?.revokeObjectURL?.(prepared.objectURL);
    }
    return true;
  };

  const hide = (session) => {
    if (!session?.terminalPreview) {
      return false;
    }
    session.cacheV2PreviewAuthorizedSnapshot = null;
    session.terminalPreview.hidden = true;
    session.terminalPreview.removeAttribute?.("src");
    if (session.shellEl?.dataset) {
      session.shellEl.dataset.previewReady = "false";
    }
    if (session.cacheV2PreviewURL) {
      URLObject?.revokeObjectURL?.(session.cacheV2PreviewURL);
      session.cacheV2PreviewURL = "";
    }
    return true;
  };

  const decode = (objectURL) => new Promise((resolve, reject) => {
    const image = new ImageCtor();
    let settled = false;
    const finish = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      image.onload = null;
      image.onerror = null;
      if (error) {
        reject(error);
      } else {
        resolve(image);
      }
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error("Terminal cache preview image decode failed."));
    image.src = objectURL;
    if (typeof image.decode === "function") {
      image.decode().then(() => finish()).catch(() => {});
    }
  });

  const canvasBlob = (canvas) => new Promise((resolve, reject) => {
    if (!isCanvas(canvas) || typeof canvas.toBlob !== "function") {
      reject(new Error("Terminal canvas capture is unavailable."));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Terminal canvas capture returned no data."));
      }
    }, "image/png");
  });

  const createObjectURL = (blob) => URLObject?.createObjectURL?.(blob) || "";
  const revokeObjectURL = (objectURL) => URLObject?.revokeObjectURL?.(objectURL);

  return Object.freeze({
    canvasBlob,
    clearPrepared,
    createObjectURL,
    decode,
    hide,
    isCanvas,
    revokeObjectURL,
  });
}

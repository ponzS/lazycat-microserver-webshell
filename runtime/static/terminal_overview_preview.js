const defaultDecodePreviewBlob = async (blob) => {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      return await globalThis.createImageBitmap(blob);
    } catch (error) {
    }
  }
  const objectURL = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const finish = (value, error = null) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      image.onload = () => finish(image);
      image.onerror = () => finish(null, new Error("Terminal overview preview image decode failed."));
      image.src = objectURL;
      if (typeof image.decode === "function") {
        image.decode().then(() => finish(image)).catch(() => {});
      }
    });
  } finally {
    URL.revokeObjectURL(objectURL);
  }
};

export class TerminalOverviewPreviewController {
  constructor({
    cache,
    canUse,
    identityFor,
    loadManifest,
    decodePreviewBlob = defaultDecodePreviewBlob,
    onReady = () => {},
    onError = () => {},
  }) {
    this.cache = cache;
    this.canUse = canUse;
    this.identityFor = identityFor;
    this.loadManifest = loadManifest;
    this.decodePreviewBlob = decodePreviewBlob;
    this.onReady = onReady;
    this.onError = onError;
  }

  clear(pane) {
    if (!pane) {
      return;
    }
    pane.cacheV2OverviewPreviewSeq = Number(pane.cacheV2OverviewPreviewSeq || 0) + 1;
    const prepared = pane.cacheV2OverviewPreview;
    pane.cacheV2OverviewPreview = null;
    pane.cacheV2OverviewPreviewPromise = null;
    prepared?.image?.close?.();
  }

  matches(pane, prepared) {
    if (!pane || !prepared?.identity || !prepared.image || !prepared.historyGeneration) {
      return false;
    }
    const paneHistoryGeneration = String(pane.historyGeneration || "").trim();
    if (paneHistoryGeneration && paneHistoryGeneration !== String(prepared.historyGeneration || "").trim()) {
      return false;
    }
    const expected = this.identityFor(pane, prepared.historyGeneration);
    try {
      return Boolean(
        expected
        && this.cache.identityMatches(expected, prepared.identity, { requireHistory: true })
        && prepared.endCursor === prepared.identity.endCursor
        && prepared.previewCursor <= prepared.endCursor
      );
    } catch (error) {
      return false;
    }
  }

  prepare(pane) {
    if (!this.canUse(pane) || pane.closed) {
      return Promise.resolve(null);
    }
    if (this.matches(pane, pane.cacheV2OverviewPreview)) {
      return Promise.resolve(pane.cacheV2OverviewPreview);
    }
    if (pane.cacheV2OverviewPreviewPromise) {
      return pane.cacheV2OverviewPreviewPromise;
    }
    this.clear(pane);
    const previewSeq = pane.cacheV2OverviewPreviewSeq;
    let previewPromise = null;
    previewPromise = (async () => {
      const snapshot = await this.loadManifest(pane);
      const expected = snapshot ? this.identityFor(pane, snapshot.historyGeneration) : null;
      if (
        !snapshot?.preview
        || !expected
        || !this.cache.identityMatches(expected, snapshot, { requireHistory: true })
      ) {
        return null;
      }
      const preview = await this.cache.loadPreview(snapshot);
      if (!preview) {
        return null;
      }
      const image = await this.decodePreviewBlob(preview.blob);
      const currentHistoryGeneration = String(pane.historyGeneration || "").trim();
      if (
        pane.closed
        || pane.cacheV2OverviewPreviewSeq !== previewSeq
        || (currentHistoryGeneration && currentHistoryGeneration !== String(snapshot.historyGeneration || "").trim())
        || !this.canUse(pane)
      ) {
        image?.close?.();
        return null;
      }
      const prepared = {
        image,
        identity: snapshot,
        historyGeneration: snapshot.historyGeneration,
        endCursor: snapshot.endCursor,
        previewCursor: preview.metadata.checkpointCursor,
      };
      if (!this.matches(pane, prepared)) {
        image?.close?.();
        return null;
      }
      pane.cacheV2OverviewPreview = prepared;
      this.onReady(pane, prepared);
      return prepared;
    })().catch((error) => {
      this.onError(pane, error);
      return null;
    }).finally(() => {
      if (pane.cacheV2OverviewPreviewPromise === previewPromise) {
        pane.cacheV2OverviewPreviewPromise = null;
      }
    });
    pane.cacheV2OverviewPreviewPromise = previewPromise;
    return previewPromise;
  }
}

export { defaultDecodePreviewBlob };

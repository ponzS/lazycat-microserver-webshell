const text = (value) => String(value ?? "").trim();

export const normalizeTerminalCacheWorkspaceIdentity = (
  state,
  expectedSelector = "",
  isClientTarget = () => false,
) => {
  const selector = text(state?.selector || expectedSelector);
  const cacheProtocolVersion = Number(state?.cache_protocol_version || 0);
  const cacheScopeID = text(state?.cache_scope_id);
  const workspaceGeneration = text(state?.workspace_generation);
  if (
    isClientTarget(selector)
    || cacheProtocolVersion !== 2
    || !cacheScopeID
    || !workspaceGeneration
    || !selector
  ) {
    return null;
  }
  return { cacheProtocolVersion, cacheScopeID, selector, workspaceGeneration };
};

export const terminalCacheWorkspaceIdentityKey = (identity) => identity
  ? JSON.stringify([
    Number(identity.cacheProtocolVersion || 0),
    text(identity.cacheScopeID),
    text(identity.selector),
    text(identity.workspaceGeneration),
  ])
  : "";

export const storedTerminalCacheSessionIdentity = (
  session,
  historyGeneration = session?.historyGeneration || "",
  isClientTarget = () => false,
) => {
  if (!session?.cacheV2WorkspaceIdentity || isClientTarget(session.name)) {
    return null;
  }
  return {
    ...session.cacheV2WorkspaceIdentity,
    tabID: text(session.tabId),
    paneID: text(session.id),
    historyGeneration: text(historyGeneration),
  };
};

// The preview metadata fingerprint is a cache identity value, not a rendering
// or settings state owner. Keep its serialization stable at the cache boundary.
export const terminalCachePreviewFingerprint = ({
  theme = "",
  foreground = "",
  background = "",
  fontSize = 0,
  fontFamily = "",
  lineHeight = 1,
} = {}) => JSON.stringify({
  theme,
  foreground,
  background,
  fontSize,
  fontFamily,
  lineHeight,
});

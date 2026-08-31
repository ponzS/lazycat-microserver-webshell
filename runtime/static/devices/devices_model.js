const cleanText = (value) => String(value || "").trim();

export function normalizeDevicePlatform(navigatorObject = globalThis.navigator) {
  const platform = cleanText(navigatorObject?.userAgentData?.platform || navigatorObject?.platform);
  const userAgent = cleanText(navigatorObject?.userAgent);
  if (/\bAndroid\b/i.test(platform) || /\bAndroid\b/i.test(userAgent)) {
    return "Android";
  }
  if (/\b(iPhone|iPad|iPod)\b/i.test(platform) || /\b(iPhone|iPad|iPod)\b/i.test(userAgent)) {
    return "iOS";
  }
  if (/\bMac/i.test(platform)) {
    return Number(navigatorObject?.maxTouchPoints || 0) > 1 ? "iOS" : "macOS";
  }
  if (/\bWin/i.test(platform)) {
    return "Windows";
  }
  if (/\bLinux/i.test(platform) || /\bX11\b/i.test(platform)) {
    return "Linux";
  }
  return "Unknown";
}

export function normalizeDeviceBrowser(navigatorObject = globalThis.navigator) {
  const userAgent = cleanText(navigatorObject?.userAgent);
  const brands = Array.isArray(navigatorObject?.userAgentData?.brands)
    ? navigatorObject.userAgentData.brands
    : [];
  const brandNames = brands.map((brand) => cleanText(brand?.brand)).filter(Boolean);
  const hasBrand = (pattern) => brandNames.some((brand) => pattern.test(brand));
  if (hasBrand(/Firefox/i) || /\bFirefox\//i.test(userAgent)) {
    return "Firefox";
  }
  if (hasBrand(/Edg/i) || /\bEdg\//i.test(userAgent)) {
    return "Edge";
  }
  if (hasBrand(/Chrome|Chromium/i) || /\bChrome\//i.test(userAgent) || /\bCriOS\//i.test(userAgent)) {
    return "Chrome";
  }
  if (/\bSafari\//i.test(userAgent) && !/\bChrome\/|\bCriOS\/|\bChromium\/|\bEdg\//i.test(userAgent)) {
    return "Safari";
  }
  return "Browser";
}

export function currentDeviceInfo({
  clientID = "",
  navigatorObject = globalThis.navigator,
} = {}) {
  const platform = normalizeDevicePlatform(navigatorObject);
  const devicePlatform = platform === "macOS" ? "Mac" : platform;
  return {
    client_id: cleanText(clientID),
    device_name: `${devicePlatform === "Unknown" ? "Unknown" : devicePlatform} ${normalizeDeviceBrowser(navigatorObject)}`,
    platform,
  };
}

export function normalizeDeviceEntries(devices) {
  if (!Array.isArray(devices)) {
    return [];
  }
  return devices.map((device) => ({
    client_id: cleanText(device?.client_id),
    device_name: cleanText(device?.device_name),
    platform: cleanText(device?.platform),
    account_id: cleanText(device?.account_id),
    joined_at: cleanText(device?.joined_at),
  }));
}

export const deviceListContentSignature = (devices) => JSON.stringify(normalizeDeviceEntries(devices));

import { installFullscreenTuiTouchAdapter } from "./fullscreen_tui_touch_adapter.js";

export const installPiFullscreenTouchAdapter = (options = {}) => (
  installFullscreenTuiTouchAdapter(options)
);

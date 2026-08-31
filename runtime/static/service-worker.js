const appShellCachePrefix = "lcmd-webshell-app-shell-";
const assetVersion = "__LCMD_ASSET_VERSION__";
const assetBase = "__LCMD_ASSET_BASE__";
const appShellCacheName = `${appShellCachePrefix}${assetVersion}`;
const terminalCacheName = "lcmd-webshell-terminal-v2";
const appShellAssets = [
  `${assetBase}style.css`,
  `${assetBase}main.js`,
  `${assetBase}global-runtime.js`,
  `${assetBase}ghostty-web.js`,
  `${assetBase}ghostty-vt.wasm`,
  `${assetBase}icon-192.png`,
  `${assetBase}icon-512.png`,
  `${assetBase}manifest.webmanifest`,
  `${assetBase}app/index.js`,
  `${assetBase}app/app_lifecycle.js`,
  `${assetBase}app/runtime_recovery_controller.js`,
  `${assetBase}app/runtime_recovery_lifecycle.js`,
  `${assetBase}app/mobile_select_controller.js`,
  `${assetBase}app/dialog_controller.js`,
  `${assetBase}app/feedback/index.js`,
  `${assetBase}app/feedback/feedback_controller.js`,
  `${assetBase}app/commands/index.js`,
  `${assetBase}app/commands/command_controller.js`,
  `${assetBase}app/commands/command_lifecycle.js`,
  `${assetBase}app/dom_registry.js`,
  `${assetBase}app/shortcuts/index.js`,
  `${assetBase}app/shortcuts/shortcut_controller.js`,
  `${assetBase}app/shortcuts/shortcut_lifecycle.js`,
  `${assetBase}app/server_revision/index.js`,
  `${assetBase}app/server_revision/server_revision_api.js`,
  `${assetBase}app/server_revision/server_revision_controller.js`,
  `${assetBase}app/server_revision/server_revision_lifecycle.js`,
  `${assetBase}app/layout/index.js`,
  `${assetBase}app/layout/layout_controller.js`,
  `${assetBase}app/bootstrap/index.js`,
  `${assetBase}app/bootstrap/bootstrap_controller.js`,
  `${assetBase}app/bootstrap/bootstrap_lifecycle.js`,
  `${assetBase}app/bootstrap/storage_persistence_controller.js`,
  `${assetBase}app/bootstrap/service_worker_controller.js`,
  `${assetBase}ui/icons/index.js`,
  `${assetBase}ui/icons/icon_controller.js`,
  `${assetBase}diagnostics/index.js`,
  `${assetBase}diagnostics/diagnostics_controller.js`,
  `${assetBase}diagnostics/network_context.js`,
  `${assetBase}diagnostics/diagnostics_lifecycle.js`,
  `${assetBase}diagnostics/diagnostics_view.js`,
  `${assetBase}diagnostics/debug_log.js`,
  `${assetBase}diagnostics/performance_meter.js`,
  `${assetBase}diagnostics/performance_tasks.js`,
  `${assetBase}diagnostics/startup_trace.js`,
  `${assetBase}diagnostics/terminal_timeline.js`,
  `${assetBase}devices/index.js`,
  `${assetBase}devices/devices_api.js`,
  `${assetBase}devices/devices_controller.js`,
  `${assetBase}devices/devices_lifecycle.js`,
  `${assetBase}devices/devices_model.js`,
  `${assetBase}devices/devices_view.js`,
  `${assetBase}service_forwarding/index.js`,
  `${assetBase}service_forwarding/service_forwarding_api.js`,
  `${assetBase}service_forwarding/service_forwarding_controller.js`,
  `${assetBase}service_forwarding/service_forwarding_lifecycle.js`,
  `${assetBase}service_forwarding/service_forwarding_model.js`,
  `${assetBase}service_forwarding/service_forwarding_view.js`,
  `${assetBase}attachments/index.js`,
  `${assetBase}attachments/attachments_api.js`,
  `${assetBase}attachments/attachments_clipboard.js`,
  `${assetBase}attachments/attachments_controller.js`,
  `${assetBase}attachments/attachments_lifecycle.js`,
  `${assetBase}attachments/attachments_model.js`,
  `${assetBase}attachments/attachments_view.js`,
  `${assetBase}instances/index.js`,
  `${assetBase}instances/instances_controller.js`,
  `${assetBase}instances/instances_lifecycle.js`,
  `${assetBase}instances/instances_loader.js`,
  `${assetBase}instances/instances_model.js`,
  `${assetBase}instances/instances_navigation.js`,
  `${assetBase}instances/instances_view.js`,
  `${assetBase}appearance/index.js`,
  `${assetBase}appearance/appearance_controller.js`,
  `${assetBase}appearance/appearance_lifecycle.js`,
  `${assetBase}appearance/appearance_view.js`,
  `${assetBase}appearance/theme_catalog.js`,
  `${assetBase}appearance/theme_model.js`,
  `${assetBase}appearance/theme_preview.js`,
  `${assetBase}appearance/runtime_controller.js`,
  `${assetBase}appearance/themes.json`,
  `${assetBase}settings/index.js`,
  `${assetBase}settings/settings_controller.js`,
  `${assetBase}settings/settings_api.js`,
  `${assetBase}settings/settings_model.js`,
  `${assetBase}settings/settings_view.js`,
  `${assetBase}settings/settings_lifecycle.js`,
  `${assetBase}settings/font_registry.js`,
  `${assetBase}settings/shortcut_editor.js`,
  `${assetBase}workspace/index.js`,
  `${assetBase}workspace/target_controller.js`,
  `${assetBase}workspace/target_lifecycle.js`,
  `${assetBase}workspace/tab_activation_controller.js`,
  `${assetBase}workspace/pane_activation_controller.js`,
  `${assetBase}workspace/pane_activation_lifecycle.js`,
  `${assetBase}workspace/layout_controller.js`,
  `${assetBase}workspace/layout_view_controller.js`,
  `${assetBase}workspace/tab_registry.js`,
  `${assetBase}workspace/activity_controller.js`,
  `${assetBase}workspace/tab_label_controller.js`,
  `${assetBase}workspace/tab_label_lifecycle.js`,
  `${assetBase}workspace/tab_navigation_controller.js`,
  `${assetBase}workspace/tab_controller.js`,
  `${assetBase}workspace/tab_view.js`,
  `${assetBase}workspace/tab_lifecycle.js`,
  `${assetBase}workspace/workspace_api.js`,
  `${assetBase}workspace/persistence_controller.js`,
  `${assetBase}workspace/presentation_controller.js`,
  `${assetBase}workspace/refresh_controller.js`,
  `${assetBase}workspace/refresh_lifecycle.js`,
  `${assetBase}workspace/state_apply_controller.js`,
  `${assetBase}workspace/state_apply_lifecycle.js`,
  `${assetBase}workspace/tab_activation_scheduler.js`,
  `${assetBase}terminal/history/index.js`,
  `${assetBase}terminal/config/index.js`,
  `${assetBase}terminal/config/terminal_config.js`,
  `${assetBase}terminal/history/cache_async.js`,
  `${assetBase}terminal/history/cache_controller.js`,
  `${assetBase}terminal/history/cache_identity.js`,
  `${assetBase}terminal/history/cache_lifecycle.js`,
  `${assetBase}terminal/history/cache_persistence_controller.js`,
  `${assetBase}terminal/history/cache_preview_view.js`,
  `${assetBase}terminal/history/cache_recovery_controller.js`,
  `${assetBase}terminal/history/cache_replay_controller.js`,
  `${assetBase}terminal/history/cache_session_lifecycle.js`,
  `${assetBase}terminal/history/client_terminal_replay.js`,
  `${assetBase}terminal/history/terminal_cache_v2.js`,
  `${assetBase}terminal/history/terminal_checkpoint.js`,
  `${assetBase}terminal/history/terminal_history_cache.js`,
  `${assetBase}terminal/history/terminal_replay_controller.js`,
  `${assetBase}terminal/history/session_replay_controller.js`,
  `${assetBase}terminal/history/session_replay_lifecycle.js`,
  `${assetBase}terminal/history/session_replay_state.js`,
  `${assetBase}terminal/output/index.js`,
  `${assetBase}terminal/output/output_controller.js`,
  `${assetBase}terminal/output/output_lifecycle.js`,
  `${assetBase}terminal/output/output_model.js`,
  `${assetBase}terminal/transport/index.js`,
  `${assetBase}terminal/transport/terminal_connection_scheduler.js`,
  `${assetBase}terminal/transport/terminal_fast_integrity.js`,
  `${assetBase}terminal/transport/terminal_queue_connection.js`,
  `${assetBase}terminal/transport/terminal_unified_connection.js`,
  `${assetBase}terminal/transport/terminal_unified_health.js`,
  `${assetBase}terminal/transport/terminal_unified_membership.js`,
  `${assetBase}terminal/transport/session_connection_controller.js`,
  `${assetBase}terminal/transport/session_connection_lifecycle.js`,
  `${assetBase}terminal/transport/session_protocol_controller.js`,
  `${assetBase}terminal/transport/transport_runtime_controller.js`,
  `${assetBase}terminal/transport/transport_runtime_lifecycle.js`,
  `${assetBase}terminal/transport/unified_transport_controller.js`,
  `${assetBase}terminal/transport/websocket_url.js`,
  `${assetBase}terminal/transport/theme_controller.js`,
  `${assetBase}terminal/rendering/index.js`,
  `${assetBase}terminal/rendering/kitty_graphics.js`,
  `${assetBase}terminal/rendering/presentation_controller.js`,
  `${assetBase}terminal/rendering/presentation_lifecycle.js`,
  `${assetBase}terminal/rendering/presentation_state.js`,
  `${assetBase}terminal/rendering/presentation_view.js`,
  `${assetBase}terminal/rendering/renderer_adapter.js`,
  `${assetBase}terminal/rendering/runtime_controller.js`,
  `${assetBase}terminal/rendering/terminal_frame_release_scheduler.js`,
  `${assetBase}terminal/rendering/terminal_render_snapshot.js`,
  `${assetBase}terminal/resize/index.js`,
  `${assetBase}terminal/resize/geometry_state.js`,
  `${assetBase}terminal/resize/resize_controller.js`,
  `${assetBase}terminal/resize/resize_lifecycle.js`,
  `${assetBase}terminal/resize/terminal_resize_controller.js`,
  `${assetBase}terminal/resize/terminal_resize_scheduler.js`,
  `${assetBase}terminal/resize/terminal_size_sync.js`,
  `${assetBase}terminal/resize/viewport_controller.js`,
  `${assetBase}terminal/viewport/index.js`,
  `${assetBase}terminal/viewport/viewport_controller.js`,
  `${assetBase}terminal/viewport/viewport_lifecycle.js`,
  `${assetBase}terminal/viewport/viewport_model.js`,
  `${assetBase}terminal/input/index.js`,
  `${assetBase}terminal/input/input_controller.js`,
  `${assetBase}terminal/input/input_lifecycle.js`,
  `${assetBase}terminal/input/input_model.js`,
  `${assetBase}terminal/input/key_overrides/index.js`,
  `${assetBase}terminal/input/key_overrides/key_overrides_controller.js`,
  `${assetBase}terminal/policy/index.js`,
  `${assetBase}terminal/policy/policy_controller.js`,
  `${assetBase}terminal/metrics/index.js`,
  `${assetBase}terminal/metrics/metrics_controller.js`,
  `${assetBase}terminal/input/mobile_shortcuts/index.js`,
  `${assetBase}terminal/input/mobile_shortcuts/mobile_shortcuts_controller.js`,
  `${assetBase}terminal/input/mobile_shortcuts/mobile_shortcuts_lifecycle.js`,
  `${assetBase}terminal/input/ime/index.js`,
  `${assetBase}terminal/input/ime/ime_controller.js`,
  `${assetBase}terminal/input/ime/ime_lifecycle.js`,
  `${assetBase}terminal/input/ime/ime_model.js`,
  `${assetBase}terminal/interaction/index.js`,
  `${assetBase}terminal/interaction/context_menu_controller.js`,
  `${assetBase}terminal/interaction/context_menu_view.js`,
  `${assetBase}terminal/interaction/interaction_lifecycle.js`,
  `${assetBase}terminal/interaction/clipboard_adapter.js`,
  `${assetBase}terminal/interaction/clipboard_controller.js`,
  `${assetBase}terminal/interaction/clipboard_lifecycle.js`,
  `${assetBase}terminal/interaction/search_controller.js`,
  `${assetBase}terminal/interaction/search_lifecycle.js`,
  `${assetBase}terminal/interaction/search_model.js`,
  `${assetBase}terminal/interaction/search_view.js`,
  `${assetBase}terminal/interaction/terminal_text_model.js`,
  `${assetBase}terminal/interaction/link_controller.js`,
  `${assetBase}terminal/interaction/link_model.js`,
  `${assetBase}terminal/mouse/index.js`,
  `${assetBase}terminal/mouse/mouse_controller.js`,
  `${assetBase}terminal/mouse/mouse_lifecycle.js`,
  `${assetBase}terminal/mouse/mouse_model.js`,
  `${assetBase}terminal/selection/index.js`,
  `${assetBase}terminal/selection/selection_controller.js`,
  `${assetBase}terminal/selection/selection_lifecycle.js`,
  `${assetBase}terminal/selection/selection_model.js`,
  `${assetBase}terminal/selection/selection_view.js`,
  `${assetBase}terminal/overview/index.js`,
  `${assetBase}terminal/overview/overview_controller.js`,
  `${assetBase}terminal/overview/overview_lifecycle.js`,
  `${assetBase}terminal/overview/overview_view.js`,
  `${assetBase}terminal/overview/terminal_overview_preview.js`,
  `${assetBase}terminal/screenshot/index.js`,
  `${assetBase}terminal/screenshot/terminal_long_screenshot.js`,
  `${assetBase}terminal/session/index.js`,
  `${assetBase}terminal/session/resource_factory.js`,
  `${assetBase}terminal/session/session_recovery_controller.js`,
  `${assetBase}terminal/session/session_controller.js`,
  `${assetBase}terminal/session/session_installation_controller.js`,
  `${assetBase}terminal/session/session_installation_lifecycle.js`,
  `${assetBase}terminal/session/startup_error_api.js`,
  `${assetBase}terminal/session/startup_error_controller.js`,
  `${assetBase}terminal/session/startup_error_lifecycle.js`,
  `${assetBase}terminal/session/session_lifecycle.js`,
  `${assetBase}terminal/session/session_state.js`,
  `${assetBase}terminal/input/ime/ios_terminal_host.js`,
  `${assetBase}terminal/tui_adapters/index.js`,
  `${assetBase}terminal/tui_adapters/installation_controller.js`,
  `${assetBase}terminal/tui_adapters/common/index.js`,
  `${assetBase}terminal/tui_adapters/common/fullscreen_tui_touch.js`,
  `${assetBase}terminal/tui_adapters/common/fullscreen_tui_touch_adapter.js`,
  `${assetBase}terminal/tui_adapters/claude/index.js`,
  `${assetBase}terminal/tui_adapters/claude/claude_fullscreen_context_menu_adapter.js`,
  `${assetBase}terminal/tui_adapters/claude/claude_fullscreen_desktop_selection_adapter.js`,
  `${assetBase}terminal/tui_adapters/claude/claude_fullscreen_touch.js`,
  `${assetBase}terminal/tui_adapters/claude/claude_fullscreen_touch_adapter.js`,
  `${assetBase}terminal/tui_adapters/opencode/index.js`,
  `${assetBase}terminal/tui_adapters/opencode/opencode_fullscreen_touch.js`,
  `${assetBase}terminal/tui_adapters/opencode/opencode_fullscreen_touch_adapter.js`,
  `${assetBase}terminal/tui_adapters/herdr/index.js`,
  `${assetBase}terminal/tui_adapters/herdr/herdr_fullscreen_touch.js`,
  `${assetBase}terminal/tui_adapters/herdr/herdr_fullscreen_touch_adapter.js`,
  `${assetBase}terminal/tui_adapters/pi/index.js`,
  `${assetBase}terminal/tui_adapters/pi/pi_fullscreen_touch.js`,
  `${assetBase}terminal/tui_adapters/pi/pi_fullscreen_touch_adapter.js`,
  `${assetBase}vendor/lzc-mobile-bridge-0.0.2.js`,
  `${assetBase}__vite-browser-external-2447137e.js`,
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(appShellCacheName);
    await Promise.all(appShellAssets.map(async (asset) => {
      try {
        const response = await fetch(asset, { cache: "no-cache", credentials: "same-origin" });
        if (response.ok) {
          await cache.put(asset, response);
        }
      } catch (error) {
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (name.startsWith(appShellCachePrefix) && name !== appShellCacheName && name !== terminalCacheName) {
        return caches.delete(name);
      }
      return Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

const isNetworkOnly = (url) => (
  url.pathname.endsWith("/service-worker.js")
  || url.pathname.includes("/api/")
  || url.pathname.endsWith("/ws")
  || url.pathname.includes("/__terminal_cache__/")
);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isNetworkOnly(url) || request.mode === "navigate") {
    return;
  }
  if (!url.pathname.includes("/assets/") && !url.pathname.includes("/static/")) {
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(appShellCacheName);
    const cached = await cache.match(request);
    const currentVersionAsset = url.pathname.startsWith(assetBase);
    if (currentVersionAsset && cached) {
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
        return response;
      }
      return cached || response;
    } catch (error) {
      if (cached) {
        return cached;
      }
      throw error;
    }
  })());
});

/**
 * Forward Email – Service Worker Sync Adapter
 *
 * This file is loaded inside the Workbox-generated sw.js via `importScripts`.
 * It instantiates the shared sync-core logic with a Service Worker-specific
 * environment (posting messages via `self.clients.matchAll`, listening for
 * `sync` and `message` events, etc.).
 *
 * The actual sync/mutation logic lives in sync-core.js (inlined at build time
 * by the `scripts/build-sw-sync.js` script).  This keeps the code DRY: the
 * same core runs on web (SW) and Tauri (main-thread shim).
 *
 * Hardening:
 *   - Message types are validated against an allowlist before dispatch.
 *   - Only windowClient sources are accepted for message events.
 *   - Payload sizes are bounds-checked.
 *
 * Build pipeline:
 *   1. Vite builds the app -> dist/
 *   2. `scripts/build-sw-sync.js` reads src/utils/sync-core.js, converts
 *      the ES module to an IIFE-compatible snippet, and injects it into
 *      this file (replacing the SYNC_CORE_PLACEHOLDER marker).
 *   3. Workbox generateSW picks up the resulting dist/sw-sync.js via
 *      `importScripts: ['sw-sync.js']` in workbox.config.cjs.
 */

/* global createSyncCore */
(function () {
  'use strict';

  // ── Inline sync-core (injected at build time) ─────────────────────────
  // @BUILD_INJECT_SYNC_CORE_START
  // SYNC_CORE_PLACEHOLDER — replaced by scripts/build-sw-sync.js
  // @BUILD_INJECT_SYNC_CORE_END

  // If the build script hasn't run yet (dev mode), provide a stub
  if (typeof createSyncCore === 'undefined') {
    console.warn('[sw-sync] sync-core not inlined; running in stub mode');
    return;
  }

  // ── Allowed message types from the frontend ───────────────────────────
  var ALLOWED_COMMANDS = { startSync: 1, cancelSync: 1, syncStatus: 1 };

  // Maximum allowed message payload size (64 KB serialised)
  var MAX_MESSAGE_SIZE = 65536;

  // ── SW-specific environment ───────────────────────────────────────────

  function postToClients(payload) {
    try {
      var clients = self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      return clients.then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          clientList[i].postMessage(payload);
        }
      });
    } catch (err) {
      console.warn('[sw-sync] postToClients failed', err);
      return Promise.resolve();
    }
  }

  var core = createSyncCore({
    postMessage: postToClients,
    fetch: self.fetch.bind(self),
    indexedDB: self.indexedDB,
  });

  // ── Background Sync event ─────────────────────────────────────────────

  self.addEventListener('sync', function (event) {
    if (event.tag === 'mutation-queue') {
      event.waitUntil(core.processMutations());
    }
  });

  // ── Message handler ───────────────────────────────────────────────────

  self.addEventListener('message', function (event) {
    // Only accept messages from window clients (not other SWs or iframes)
    if (event.source && event.source.type && event.source.type !== 'window') {
      return;
    }

    var data = event.data || {};
    if (!data.type || typeof data.type !== 'string') return;

    // Validate command type against allowlist
    if (!ALLOWED_COMMANDS[data.type]) return;

    // Bounds-check payload size
    try {
      var serialized = JSON.stringify(data);
      if (serialized.length > MAX_MESSAGE_SIZE) {
        console.warn('[sw-sync] Rejected oversized message:', serialized.length);
        return;
      }
    } catch {
      return;
    }

    if (data.type === 'startSync') {
      core.startSync(data);
    } else if (data.type === 'cancelSync') {
      core.cancelSync(data.accountId, data.folderId);
    } else if (data.type === 'syncStatus') {
      core.getSyncStatus(data.accountId, data.folderId);
    }
  });
})();

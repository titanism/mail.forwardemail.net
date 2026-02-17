/**
 * Forward Email – Sync Core (Platform-Agnostic)
 *
 * This module contains the shared synchronization and mutation-queue logic
 * extracted from the former `public/sw-sync.js`.  It is pure JavaScript with
 * **no** Service Worker, DOM, or Svelte dependencies so it can run in:
 *
 *   1. A Service Worker context  (web — via sw-adapter.js)
 *   2. The main thread / a Web Worker  (Tauri, fallback web)
 *
 * Every platform-specific concern (posting messages to clients, registering
 * background sync, etc.) is injected through the `env` object passed to
 * `createSyncCore()`.
 *
 * ─── Environment contract ────────────────────────────────────────────────
 *
 *   env.postMessage(payload)        → send a message to the UI / clients
 *   env.fetch(url, init)            → fetch wrapper (defaults to globalThis.fetch)
 *   env.indexedDB                   → IDBFactory reference (defaults to globalThis.indexedDB)
 *
 * ─── Exported factory ────────────────────────────────────────────────────
 *
 *   const core = createSyncCore(env);
 *   await core.startSync({ accountId, folderId, ... });
 *   await core.processMutations();
 *   core.cancelSync(accountId, folderId);
 *   await core.getSyncStatus(accountId, folderId);
 */

// ── Constants ──────────────────────────────────────────────────────────────
const SCHEMA_VERSION = 1;
const DB_NAME = `webmail-cache-v${SCHEMA_VERSION}`;
const MANIFEST_STORE = 'syncManifests';
const MESSAGES_STORE = 'messages';
const BODIES_STORE = 'messageBodies';
const FOLDERS_STORE = 'folders';
const META_STORE = 'meta';
const MUTATION_QUEUE_PREFIX = 'mutation_queue_';
const MUTATION_MAX_RETRIES = 5;
const DEFAULT_PAGE_SIZE = 100;
const LOG = false;

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a platform-agnostic sync core.
 *
 * @param {Object} env
 * @param {Function} env.postMessage  – (payload: object) => Promise<void>
 * @param {Function} [env.fetch]      – fetch implementation (defaults to globalThis.fetch)
 * @param {IDBFactory} [env.indexedDB] – IDBFactory (defaults to globalThis.indexedDB)
 * @returns {Object} sync core API
 */
export function createSyncCore(env = {}) {
  const _fetch = env.fetch || globalThis.fetch.bind(globalThis);
  const _idb = env.indexedDB || globalThis.indexedDB;
  const _post = env.postMessage || (() => Promise.resolve());

  const state = new Map(); // folderKey → { cancelled, running }

  // ── IndexedDB helpers ──────────────────────────────────────────────────

  const openDb = () =>
    new Promise((resolve, reject) => {
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 500;

      const attemptOpen = () => {
        const req = _idb.open(DB_NAME);

        req.onupgradeneeded = (event) => {
          const db = req.result;
          if (event.oldVersion === 0 || !db.objectStoreNames.contains(MANIFEST_STORE)) {
            try {
              db.createObjectStore(MANIFEST_STORE, {
                keyPath: ['account', 'folder'],
              });
            } catch {
              // store may already exist
            }
          }
        };

        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
          };

          if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
            const nextVersion = db.version + 1;
            db.close();
            const upgradeReq = _idb.open(DB_NAME, nextVersion);

            upgradeReq.onupgradeneeded = () => {
              const udb = upgradeReq.result;
              if (!udb.objectStoreNames.contains(MANIFEST_STORE)) {
                try {
                  udb.createObjectStore(MANIFEST_STORE, {
                    keyPath: ['account', 'folder'],
                  });
                } catch {
                  // ignore
                }
              }
            };

            upgradeReq.onsuccess = () => {
              const udb = upgradeReq.result;
              udb.onversionchange = () => udb.close();
              resolve(udb);
            };

            upgradeReq.onerror = () => {
              const error = upgradeReq.error;
              if (error?.name === 'VersionError') {
                const retryReq = _idb.open(DB_NAME);
                retryReq.onsuccess = () => resolve(retryReq.result);
                retryReq.onerror = () => reject(retryReq.error);
              } else {
                reject(error || new Error('IndexedDB upgrade failed'));
              }
            };

            upgradeReq.onblocked = () => {
              // wait for unblock
            };

            return;
          }

          resolve(db);
        };

        req.onerror = () => {
          const error = req.error;
          if (
            retryCount < maxRetries &&
            (error?.name === 'AbortError' || error?.name === 'UnknownError')
          ) {
            retryCount++;
            setTimeout(attemptOpen, retryDelay * retryCount);
            return;
          }

          reject(error || new Error('IndexedDB open failed'));
        };

        req.onblocked = () => {
          setTimeout(() => {
            if (req.readyState === 'pending') {
              reject(new Error('IndexedDB open blocked'));
            }
          }, 10_000);
        };
      };

      attemptOpen();
    });

  const withStore = async (storeNames, mode, fn) => {
    let db;
    try {
      db = await openDb();
    } catch (err) {
      await _post({
        type: 'dbError',
        error: err.message,
        errorName: err.name,
        recoverable: ['VersionError', 'InvalidStateError', 'NotFoundError'].includes(err.name),
      });
      throw err;
    }

    return new Promise((resolve, reject) => {
      const missingStores = storeNames.filter((name) => !db.objectStoreNames.contains(name));
      if (missingStores.length > 0) {
        _post({
          type: 'dbError',
          error: `Missing object stores: ${missingStores.join(', ')}`,
          errorName: 'NotFoundError',
          recoverable: true,
        });
        reject(new Error(`Missing object stores: ${missingStores.join(', ')}`));
        return;
      }

      try {
        const tx = db.transaction(storeNames, mode);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        fn(tx);
      } catch (err) {
        reject(err);
      }
    });
  };

  // ── Manifest ───────────────────────────────────────────────────────────

  const readManifest = async (account, folder) => {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(MANIFEST_STORE, 'readonly');
        const store = tx.objectStore(MANIFEST_STORE);
        const req = store.get([account, folder]);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  };

  const writeManifest = async (manifest) => {
    const toWrite = { ...manifest, updatedAt: Date.now() };
    await withStore([MANIFEST_STORE], 'readwrite', (tx) => {
      tx.objectStore(MANIFEST_STORE).put(toWrite);
    });
  };

  // ── Message normalisation ──────────────────────────────────────────────

  const normalizeMessage = (raw, account, folder) => {
    const rawDate = raw.Date || raw.date || raw.header_date || raw.internal_date || raw.received_at;
    const parsedDate = new Date(rawDate || Date.now());
    const dateMs = Number.isFinite(parsedDate.getTime()) ? parsedDate.getTime() : Date.now();
    const subject = raw.Subject || raw.subject || '(No subject)';
    const flags = Array.isArray(raw.flags) ? raw.flags : [];
    const messageId =
      raw.MessageId || raw.message_id || raw['Message-ID'] || raw.id || raw.Uid || raw.uid;

    return {
      id: raw.Uid || raw.id || raw.uid,
      account,
      folder: raw.folder_path || raw.folder || raw.path || folder,
      dateMs,
      date: dateMs,
      from:
        raw.From?.Display ||
        raw.From?.Email ||
        raw.from?.text ||
        raw.from ||
        raw.sender ||
        (raw.nodemailer?.from && raw.nodemailer.from.text) ||
        'Unknown',
      subject,
      normalizedSubject: subject,
      snippet:
        raw.Plain?.slice?.(0, 140) ||
        raw.snippet ||
        raw.preview ||
        raw.textAsHtml ||
        raw.text ||
        raw.nodemailer?.textAsHtml ||
        raw.nodemailer?.text ||
        '',
      flags,
      is_unread: Array.isArray(flags) ? !flags.includes('\\Seen') : (raw.is_unread ?? true),
      is_starred: raw.is_starred || flags.includes('\\Flagged'),
      has_attachment: Boolean(raw.has_attachment || raw.hasAttachments),
      bodyIndexed: false,
      pending: false,
      threadId: raw.threadId || raw.ThreadId || raw.thread_id,
      message_id: messageId,
      in_reply_to: raw.in_reply_to || raw.inReplyTo || raw['In-Reply-To'],
      references: raw.references || raw.References,
      updatedAt: Date.now(),
    };
  };

  // ── Write helpers ──────────────────────────────────────────────────────

  const writeMessages = async (messages) => {
    if (!messages?.length) return;
    await withStore([MESSAGES_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(MESSAGES_STORE);
      for (const msg of messages) store.put(msg);
    });
  };

  const writeBodies = async (bodies) => {
    if (!bodies?.length) return;
    await withStore([BODIES_STORE], 'readwrite', (tx) => {
      const store = tx.objectStore(BODIES_STORE);
      for (const body of bodies) store.put(body);
    });
  };

  // ── Fetch helpers ──────────────────────────────────────────────────────

  const trimApiBase = (apiBase = '') => (apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase);

  const fetchJson = async (url, headers) => {
    const res = await _fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Request failed ${res.status}: ${text}`);
    }

    return res.json();
  };

  const fetchFolders = (apiBase, headers) =>
    fetchJson(`${trimApiBase(apiBase)}/v1/folders`, headers);

  const fetchMessagesPage = (apiBase, headers, folder, page, limit) => {
    const url = new URL(`${trimApiBase(apiBase)}/v1/messages`);
    url.searchParams.set('folder', folder);
    url.searchParams.set('page', page);
    url.searchParams.set('limit', limit);
    return fetchJson(url.toString(), headers);
  };

  const fetchMessageDetail = (apiBase, headers, messageId, folder) => {
    const url = `${trimApiBase(apiBase)}/v1/messages/${encodeURIComponent(messageId)}?folder=${encodeURIComponent(folder)}`;
    return fetchJson(url, headers);
  };

  const isCancelled = (folderKey) => state.get(folderKey)?.cancelled;

  const fetchBodiesForMessages = async (messages, { apiBase, headers, accountId, folderId }) => {
    const bodies = [];
    for (const msg of messages) {
      if (!msg?.id) continue;
      if (isCancelled(`${accountId}:${folderId}`)) break;
      try {
        const detail = await fetchMessageDetail(apiBase, headers, msg.id, folderId);
        const result = detail?.Result || detail || {};
        const serverText =
          result?.Plain ||
          result?.text ||
          result?.body ||
          result?.preview ||
          result?.nodemailer?.text ||
          result?.nodemailer?.preview ||
          '';
        const rawBody =
          result?.html ||
          result?.Html ||
          result?.textAsHtml ||
          result?.nodemailer?.html ||
          result?.nodemailer?.textAsHtml ||
          serverText ||
          msg.snippet ||
          '';
        const detailAttachments = result?.nodemailer?.attachments || result?.attachments || [];
        const attachments = detailAttachments.map((att) => ({
          name: att.name || att.filename,
          filename: att.filename,
          size: att.size,
          contentId: att.cid || att.contentId,
          href: att.url || '',
          contentType: att.contentType || att.mimeType || att.type,
        }));
        bodies.push({
          account: accountId,
          id: msg.id,
          folder: folderId,
          body: rawBody,
          textContent: serverText || rawBody,
          attachments,
          updatedAt: Date.now(),
        });
      } catch (err) {
        LOG && console.warn('[sync-core] fetch body failed', err);
      }
    }

    if (bodies.length) {
      await writeBodies(bodies);
    }
  };

  // ── Sync ───────────────────────────────────────────────────────────────

  const startSync = async (opts) => {
    const {
      accountId,
      folderId,
      fetchBodies = false,
      apiBase,
      authToken,
      pageSize = DEFAULT_PAGE_SIZE,
      maxMessages,
    } = opts;
    const folderKey = `${accountId}:${folderId}`;
    state.set(folderKey, { cancelled: false, running: true });
    await _post({
      type: 'syncProgress',
      folderId,
      status: 'running',
      pagesDone: 0,
      messagesDone: 0,
    });

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers.Authorization = `Basic ${btoa(authToken)}`;
    }

    try {
      if (!authToken) throw new Error('Missing auth token for sync');
      const cleanedApiBase = trimApiBase(apiBase);

      // Step 1: cache folders (best effort)
      try {
        const folderRes = await fetchFolders(cleanedApiBase, headers);
        const list = folderRes?.Result || folderRes?.folders || folderRes || [];
        if (Array.isArray(list) && list.length) {
          await withStore([FOLDERS_STORE], 'readwrite', (tx) => {
            const store = tx.objectStore(FOLDERS_STORE);
            for (const f of list) {
              const path = f.path || f.name || f.Path || f.Name;
              if (!path) continue;
              store.put({
                account: accountId,
                path,
                name: f.name || f.Name || path,
                unread_count: f.unread_count || f.Unread || 0,
                specialUse: f.specialUse || f.SpecialUse,
                updatedAt: Date.now(),
              });
            }
          });
        }
      } catch (err) {
        LOG && console.warn('[sync-core] folder fetch skipped', err);
      }

      // Step 2: paginated message sync
      let manifest = {
        account: accountId,
        folder: folderId,
        lastUID: null,
        lastSyncAt: Date.now(),
        pagesFetched: 0,
        messagesFetched: 0,
        hasBodiesPass: false,
      };

      let page = 1;
      let totalMessages = 0;
      let continuePaging = true;

      while (continuePaging) {
        if (isCancelled(folderKey)) {
          await _post({
            type: 'syncCancelled',
            folderId,
            pagesDone: manifest.pagesFetched,
            messagesDone: manifest.messagesFetched,
          });
          state.set(folderKey, { cancelled: false, running: false });
          return;
        }

        const res = await fetchMessagesPage(cleanedApiBase, headers, folderId, page, pageSize);
        const list =
          res?.Result?.List || res?.Result?.list || res?.Result || res?.List || res || [];
        if (!Array.isArray(list) || !list.length) {
          continuePaging = false;
          break;
        }

        const mapped = list.map((raw) => normalizeMessage(raw, accountId, folderId));
        await writeMessages(mapped);
        if (fetchBodies) {
          await fetchBodiesForMessages(mapped, {
            apiBase: cleanedApiBase,
            headers,
            accountId,
            folderId,
          });
        }

        manifest = {
          ...manifest,
          lastSyncAt: Date.now(),
          pagesFetched: page,
          messagesFetched: totalMessages + mapped.length,
          lastUID: mapped[0]?.id || manifest.lastUID,
        };
        await writeManifest(manifest);
        await _post({
          type: 'syncProgress',
          folderId,
          status: 'running',
          pagesDone: manifest.pagesFetched,
          messagesDone: manifest.messagesFetched,
          lastUID: manifest.lastUID,
        });

        totalMessages += mapped.length;
        page += 1;

        if (maxMessages && totalMessages >= maxMessages) break;
      }

      await _post({
        type: 'syncComplete',
        folderId,
        messagesDone: manifest.messagesFetched,
        lastUID: manifest.lastUID,
        lastSyncAt: manifest.lastSyncAt,
      });
      state.set(folderKey, { cancelled: false, running: false });
    } catch (err) {
      console.error('[sync-core] sync failed', err);
      await _post({
        type: 'syncProgress',
        folderId,
        status: 'error',
        error: err.message,
        pagesDone: 0,
        messagesDone: 0,
      });
      state.set(folderKey, { cancelled: false, running: false });
    }
  };

  // ── Mutation Queue ─────────────────────────────────────────────────────

  const readAllMutationQueues = async () => {
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const results = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(results);
          return;
        }

        const record = cursor.value;
        if (
          record?.key &&
          typeof record.key === 'string' &&
          record.key.startsWith(MUTATION_QUEUE_PREFIX) &&
          Array.isArray(record.value)
        ) {
          results.push({ key: record.key, queue: record.value });
        }

        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  };

  const writeMutationQueue = async (key, queue) => {
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      store.put({ key, value: queue, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  };

  const executeMutation = async (mutation) => {
    const { type, payload, apiBase, authHeader } = mutation;
    if (!apiBase || !authHeader) return false;

    const base = trimApiBase(apiBase);
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader,
    };

    const msgPath = `/v1/messages/${encodeURIComponent(payload.messageId)}`;

    switch (type) {
      case 'toggleRead': {
        const flags = payload.isUnread
          ? (payload.flags || []).filter((f) => f !== '\\Seen')
          : [...(payload.flags || []), '\\Seen'];
        const res = await _fetch(`${base}${msgPath}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ flags, folder: payload.folder }),
        });
        return res.ok;
      }

      case 'toggleStar': {
        const flags = payload.isStarred
          ? (payload.flags || []).filter((f) => f !== '\\Flagged')
          : [...(payload.flags || []), '\\Flagged'];
        const res = await _fetch(`${base}${msgPath}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ flags, folder: payload.folder }),
        });
        return res.ok;
      }

      case 'move': {
        const res = await _fetch(`${base}${msgPath}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ folder: payload.targetFolder }),
        });
        return res.ok;
      }

      case 'delete': {
        const path = payload.permanent ? `${msgPath}?permanent=1` : msgPath;
        const res = await _fetch(`${base}${path}`, {
          method: 'DELETE',
          headers,
        });
        return res.ok;
      }

      case 'label': {
        const res = await _fetch(`${base}${msgPath}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ labels: payload.labels }),
        });
        return res.ok;
      }

      default:
        return false;
    }
  };

  const processMutations = async () => {
    let queues;
    try {
      queues = await readAllMutationQueues();
    } catch (err) {
      LOG && console.warn('[sync-core] Failed to read mutation queues', err);
      return;
    }

    for (const { key, queue } of queues) {
      let modified = false;
      for (const mutation of queue) {
        if (mutation.status === 'completed') continue;
        if (mutation.status === 'failed' && mutation.retryCount >= MUTATION_MAX_RETRIES) continue;
        if (mutation.nextRetryAt && Date.now() < mutation.nextRetryAt) continue;

        mutation.status = 'processing';
        modified = true;

        try {
          const ok = await executeMutation(mutation);
          mutation.status = ok ? 'completed' : 'failed';
          if (!ok) mutation.retryCount = (mutation.retryCount || 0) + 1;
        } catch {
          mutation.retryCount = (mutation.retryCount || 0) + 1;
          mutation.status = mutation.retryCount >= MUTATION_MAX_RETRIES ? 'failed' : 'pending';
        }
      }

      if (modified) {
        const remaining = queue.filter((m) => m.status !== 'completed');
        try {
          await writeMutationQueue(key, remaining);
        } catch (err) {
          LOG && console.warn('[sync-core] Failed to write mutation queue', err);
        }
      }
    }

    await _post({ type: 'mutationQueueProcessed' });
  };

  // ── Cancel ─────────────────────────────────────────────────────────────

  const cancelSync = (accountId, folderId) => {
    const key = `${accountId}:${folderId}`;
    const current = state.get(key) || {};
    current.cancelled = true;
    state.set(key, current);
  };

  // ── Status ─────────────────────────────────────────────────────────────

  const getSyncStatus = async (accountId, folderId) => {
    const manifest = await readManifest(accountId, folderId);
    await _post({
      type: 'syncProgress',
      folderId,
      status: 'idle',
      pagesDone: manifest?.pagesFetched || 0,
      messagesDone: manifest?.messagesFetched || 0,
      lastUID: manifest?.lastUID || null,
      lastSyncAt: manifest?.lastSyncAt || null,
    });
  };

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    startSync,
    cancelSync,
    getSyncStatus,
    processMutations,
  };
}

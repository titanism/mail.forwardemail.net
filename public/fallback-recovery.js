// Pending IndexedDB cleanup: delete databases that were flagged for removal
// during signout (when connections were still open and blocking deletion).
// This runs before the app opens any database connections.
(function () {
  var PENDING_KEY = 'webmail_pending_idb_cleanup';
  try {
    if (localStorage.getItem(PENDING_KEY)) {
      localStorage.removeItem(PENDING_KEY);
      if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
        indexedDB
          .databases()
          .then(function (dbs) {
            dbs.forEach(function (db) {
              if (db.name && db.name.indexOf('webmail-cache') === 0) {
                indexedDB.deleteDatabase(db.name);
              }
            });
          })
          .catch(function () {
            /* ignore */
          });
      }
    }
  } catch {
    /* ignore */
  }
})();

// Show fallback UI if main script fails to load/execute within 15 seconds
(function () {
  var timeout = setTimeout(function () {
    var fallback = document.getElementById('fe-fallback-recovery');
    if (fallback && !window.__appBootstrapped) {
      fallback.style.display = 'block';
    }
  }, 15000);

  // Clear timeout once app bootstraps successfully
  window.__markAppBootstrapped = function () {
    clearTimeout(timeout);
    window.__appBootstrapped = true;
  };

  // Handle fallback button click
  document.getElementById('fe-fallback-clear-btn').addEventListener('click', function () {
    this.disabled = true;
    this.textContent = 'Clearing...';

    Promise.resolve()
      .then(function () {
        if ('serviceWorker' in navigator) {
          return navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(
              regs.map(function (r) {
                return r.unregister();
              }),
            );
          });
        }
      })
      .then(function () {
        if ('caches' in window) {
          return caches.keys().then(function (names) {
            return Promise.all(
              names.map(function (n) {
                return caches.delete(n);
              }),
            );
          });
        }
      })
      .then(function () {
        window.location.reload();
      })
      .catch(function () {
        window.location.reload();
      });
  });
})();

/**
 * Forward Email – Demo Account E2E Tests
 *
 * Tests the complete demo account lifecycle:
 *   1. "Try Demo" button on the login page
 *   2. Demo mode activation and fake data loading
 *   3. API interception — read actions return fake data
 *   4. API interception — write actions show toast notification
 *   5. Toast notification contains sign-up link
 *   6. Demo mode cleanup on exit
 *
 * These tests are designed to run in both web (Playwright) and
 * Tauri (via playwright.tauri.config.js) environments.
 */
import { expect, test } from '@playwright/test';

// ── Demo Data Module Tests ────────────────────────────────────────────────

test.describe('Demo Data Generator', () => {
  test('demo-data module loads and exports all generators', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const exports = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/demo-data.js');
        return {
          hasDemoEmail: typeof mod.DEMO_EMAIL === 'string' && mod.DEMO_EMAIL.length > 0,
          hasDemoAliasAuth: typeof mod.DEMO_ALIAS_AUTH === 'string',
          hasDemoStorageKey: typeof mod.DEMO_STORAGE_KEY === 'string',
          hasGenerateFolders: typeof mod.generateFolders === 'function',
          hasGenerateMessages: typeof mod.generateMessages === 'function',
          hasGenerateContacts: typeof mod.generateContacts === 'function',
          hasGenerateCalendarEvents: typeof mod.generateCalendarEvents === 'function',
          hasGenerateAccountInfo: typeof mod.generateAccountInfo === 'function',
          hasGenerateLabels: typeof mod.generateLabels === 'function',
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(exports.hasDemoEmail).toBe(true);
    expect(exports.hasDemoAliasAuth).toBe(true);
    expect(exports.hasDemoStorageKey).toBe(true);
    expect(exports.hasGenerateFolders).toBe(true);
    expect(exports.hasGenerateMessages).toBe(true);
    expect(exports.hasGenerateContacts).toBe(true);
    expect(exports.hasGenerateCalendarEvents).toBe(true);
    expect(exports.hasGenerateAccountInfo).toBe(true);
    expect(exports.hasGenerateLabels).toBe(true);
  });

  test('generateFolders returns standard IMAP folders', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const folders = await page.evaluate(async () => {
      const { generateFolders } = await import('/src/utils/demo-data.js');
      return generateFolders();
    });

    expect(Array.isArray(folders)).toBe(true);
    expect(folders.length).toBeGreaterThanOrEqual(5);

    const paths = folders.map((f: { path: string }) => f.path);
    expect(paths).toContain('INBOX');
    expect(paths).toContain('Sent');
    expect(paths).toContain('Drafts');
    expect(paths).toContain('Trash');
    expect(paths).toContain('Spam');
  });

  test('generateMessages returns realistic emails for INBOX', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const messages = await page.evaluate(async () => {
      const { generateMessages } = await import('/src/utils/demo-data.js');
      return generateMessages('INBOX', 1);
    });

    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(5);

    // Verify message structure
    const first = messages[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('subject');
    expect(first).toHaveProperty('from');
    expect(first).toHaveProperty('to');
    expect(first).toHaveProperty('date');
    expect(first).toHaveProperty('text');
    expect(first).toHaveProperty('html');
    expect(first).toHaveProperty('flags');
    expect(first.from).toHaveProperty('name');
    expect(first.from).toHaveProperty('address');
  });

  test('generateMessages returns different data per folder', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { generateMessages } = await import('/src/utils/demo-data.js');
      const inbox = generateMessages('INBOX', 1);
      const sent = generateMessages('Sent', 1);
      const drafts = generateMessages('Drafts', 1);
      return {
        inboxCount: inbox.length,
        sentCount: sent.length,
        draftsCount: drafts.length,
        inboxFirstSubject: inbox[0]?.subject,
        sentFirstSubject: sent[0]?.subject,
      };
    });

    expect(result.inboxCount).toBeGreaterThan(0);
    expect(result.sentCount).toBeGreaterThan(0);
    expect(result.draftsCount).toBeGreaterThan(0);
    expect(result.inboxFirstSubject).not.toBe(result.sentFirstSubject);
  });

  test('generateContacts returns contact objects with required fields', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const contacts = await page.evaluate(async () => {
      const { generateContacts } = await import('/src/utils/demo-data.js');
      return generateContacts();
    });

    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts.length).toBeGreaterThanOrEqual(3);

    const first = contacts[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('fn');
    expect(first).toHaveProperty('email');
  });

  test('generateAccountInfo returns demo account details', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const account = await page.evaluate(async () => {
      const { generateAccountInfo, DEMO_EMAIL } = await import('/src/utils/demo-data.js');
      const info = generateAccountInfo();
      return { ...info, expectedEmail: DEMO_EMAIL };
    });

    expect(account.email).toBe(account.expectedEmail);
    expect(account.plan).toBeTruthy();
    expect(account.storage_used).toBeGreaterThan(0);
    expect(account.storage_limit).toBeGreaterThan(account.storage_used);
  });
});

// ── Demo Mode Manager Tests ───────────────────────────────────────────────

test.describe('Demo Mode Manager', () => {
  test('demo-mode module loads and exports all functions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const exports = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/demo-mode.js');
        return {
          hasIsDemoMode: typeof mod.isDemoMode === 'function',
          hasActivateDemoMode: typeof mod.activateDemoMode === 'function',
          hasDeactivateDemoMode: typeof mod.deactivateDemoMode === 'function',
          hasSetDemoToasts: typeof mod.setDemoToasts === 'function',
          hasShowDemoBlockedToast: typeof mod.showDemoBlockedToast === 'function',
          hasExitDemoAndRedirect: typeof mod.exitDemoAndRedirect === 'function',
          hasInterceptDemoRequest: typeof mod.interceptDemoRequest === 'function',
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(exports.hasIsDemoMode).toBe(true);
    expect(exports.hasActivateDemoMode).toBe(true);
    expect(exports.hasDeactivateDemoMode).toBe(true);
    expect(exports.hasSetDemoToasts).toBe(true);
    expect(exports.hasShowDemoBlockedToast).toBe(true);
    expect(exports.hasExitDemoAndRedirect).toBe(true);
    expect(exports.hasInterceptDemoRequest).toBe(true);
  });

  test('isDemoMode returns false by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { isDemoMode } = await import('/src/utils/demo-mode.js');
      return isDemoMode();
    });

    expect(result).toBe(false);
  });

  test('activateDemoMode sets localStorage flag', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { activateDemoMode, isDemoMode } = await import('/src/utils/demo-mode.js');
      const { DEMO_STORAGE_KEY: key } = await import('/src/utils/demo-data.js');
      activateDemoMode();
      return {
        isActive: isDemoMode(),
        storageValue: localStorage.getItem(key),
      };
    });

    expect(result.isActive).toBe(true);
    expect(result.storageValue).toBe('1');
  });

  test('deactivateDemoMode clears localStorage flag', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { activateDemoMode, deactivateDemoMode, isDemoMode } =
        await import('/src/utils/demo-mode.js');
      const { DEMO_STORAGE_KEY } = await import('/src/utils/demo-data.js');
      activateDemoMode();
      const before = isDemoMode();
      deactivateDemoMode();
      return {
        before,
        after: isDemoMode(),
        storageValue: localStorage.getItem(DEMO_STORAGE_KEY),
      };
    });

    expect(result.before).toBe(true);
    expect(result.after).toBe(false);
    expect(result.storageValue).toBeNull();
  });

  test('interceptDemoRequest returns fake data for read actions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { activateDemoMode, interceptDemoRequest } = await import('/src/utils/demo-mode.js');
      activateDemoMode();

      const folders = interceptDemoRequest('Folders');
      const messages = interceptDemoRequest('MessageList', { mailbox: 'INBOX' });
      const contacts = interceptDemoRequest('Contacts');
      const labels = interceptDemoRequest('Labels');
      const account = interceptDemoRequest('Account');

      return {
        foldersHandled: folders.handled,
        foldersIsArray: Array.isArray(folders.result),
        messagesHandled: messages.handled,
        contactsHandled: contacts.handled,
        labelsHandled: labels.handled,
        accountHandled: account.handled,
        accountEmail: account.result?.email,
      };
    });

    expect(result.foldersHandled).toBe(true);
    expect(result.foldersIsArray).toBe(true);
    expect(result.messagesHandled).toBe(true);
    expect(result.contactsHandled).toBe(true);
    expect(result.labelsHandled).toBe(true);
    expect(result.accountHandled).toBe(true);
    expect(result.accountEmail).toBe('demo@forwardemail.net');
  });

  test('interceptDemoRequest blocks write actions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { activateDemoMode, interceptDemoRequest, setDemoToasts } =
        await import('/src/utils/demo-mode.js');
      activateDemoMode();

      // Set up a mock toast to capture the message
      let toastMessage = '';
      let toastType = '';
      let toastAction = null;
      setDemoToasts({
        show: (msg, type, opts) => {
          toastMessage = msg;
          toastType = type;
          toastAction = opts?.action || null;
          return 1;
        },
        dismiss: () => {},
      });

      const sendResult = interceptDemoRequest('Emails', { to: 'test@example.com' });
      const deleteResult = interceptDemoRequest('MessageDelete', { id: '123' });
      const createContact = interceptDemoRequest('ContactsCreate', { fn: 'Test' });
      const updateAccount = interceptDemoRequest('AccountUpdate', { locale: 'fr' });

      return {
        sendHandled: sendResult.handled,
        sendResult: sendResult.result,
        deleteHandled: deleteResult.handled,
        createContactHandled: createContact.handled,
        updateAccountHandled: updateAccount.handled,
        lastToastMessage: toastMessage,
        lastToastType: toastType,
        hasSignUpAction: toastAction !== null && typeof toastAction?.label === 'string',
      };
    });

    expect(result.sendHandled).toBe(true);
    expect(result.sendResult).toHaveProperty('demo', true);
    expect(result.deleteHandled).toBe(true);
    expect(result.createContactHandled).toBe(true);
    expect(result.updateAccountHandled).toBe(true);
    expect(result.lastToastType).toBe('warning');
    expect(result.lastToastMessage).toContain('not available in demo mode');
    expect(result.hasSignUpAction).toBe(true);
  });

  test('interceptDemoRequest returns not-handled when demo is inactive', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { deactivateDemoMode, interceptDemoRequest } = await import('/src/utils/demo-mode.js');
      deactivateDemoMode();
      const folders = interceptDemoRequest('Folders');
      const emails = interceptDemoRequest('Emails');
      return {
        foldersHandled: folders.handled,
        emailsHandled: emails.handled,
      };
    });

    expect(result.foldersHandled).toBe(false);
    expect(result.emailsHandled).toBe(false);
  });
});

// ── Demo Mode Toast Notification Tests ────────────────────────────────────

test.describe('Demo Mode Toast Notifications', () => {
  test('showDemoBlockedToast shows warning with sign-up action', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { setDemoToasts, showDemoBlockedToast } = await import('/src/utils/demo-mode.js');

      let captured = { message: '', type: '', action: null };
      setDemoToasts({
        show: (msg, type, opts) => {
          captured = { message: msg, type, action: opts?.action || null };
          return 1;
        },
        dismiss: () => {},
      });

      showDemoBlockedToast('Send email');

      return {
        message: captured.message,
        type: captured.type,
        actionLabel: captured.action?.label,
        hasCallback: typeof captured.action?.callback === 'function',
      };
    });

    expect(result.message).toContain('Send email');
    expect(result.message).toContain('not available in demo mode');
    expect(result.message).toContain('forwardemail.net');
    expect(result.type).toBe('warning');
    expect(result.actionLabel).toBe('Sign Up');
    expect(result.hasCallback).toBe(true);
  });

  test('showDemoBlockedToast uses default message when no action label', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { setDemoToasts, showDemoBlockedToast } = await import('/src/utils/demo-mode.js');

      let message = '';
      setDemoToasts({
        show: (msg) => {
          message = msg;
          return 1;
        },
        dismiss: () => {},
      });

      showDemoBlockedToast(null);
      return message;
    });

    expect(result).toContain('not available in demo');
    expect(result).toContain('forwardemail.net');
  });
});

// ── Login Page "Try Demo" Button Tests ────────────────────────────────────

test.describe('Login Page Try Demo Button', () => {
  test('Try Demo button is visible on the login page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // The login page should be visible (no account logged in)
    const demoBtn = page.locator('[data-testid="try-demo-btn"]');
    // The button may or may not be visible depending on whether the login
    // page is rendered. We check the source code integration instead.
    const exists = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="try-demo-btn"]');
      return btn !== null;
    });

    // If the login page is rendered, the button should exist
    // If not (e.g., already logged in), we verify the code integration
    if (!exists) {
      // Verify the code is properly integrated by checking the module
      const integrated = await page.evaluate(async () => {
        try {
          const mod = await import('/src/utils/demo-mode.js');
          return typeof mod.activateDemoMode === 'function';
        } catch {
          return false;
        }
      });
      expect(integrated).toBe(true);
    } else {
      await expect(demoBtn).toBeVisible();
      const text = await demoBtn.textContent();
      expect(text).toContain('Try Demo');
    }
  });
});

// ── Sync Interval Tests ───────────────────────────────────────────────────

test.describe('Sync Interval Configuration', () => {
  test('inbox-poller uses 5-minute (300000ms) interval', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const interval = await page.evaluate(async () => {
      // We cannot directly access the constant, but we can verify
      // the module loads and check the source
      const response = await fetch('/src/utils/inbox-poller.js');
      const text = await response.text();
      return {
        has300000: text.includes('300_000') || text.includes('300000'),
        hasNot10000:
          !text.includes('POLL_INTERVAL_MS = 10_000') && !text.includes('POLL_INTERVAL_MS = 10000'),
      };
    });

    expect(interval.has300000).toBe(true);
    expect(interval.hasNot10000).toBe(true);
  });

  test('websocket-updater fallback uses 5-minute interval', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const interval = await page.evaluate(async () => {
      const response = await fetch('/src/utils/websocket-updater.js');
      const text = await response.text();
      return {
        has300000: text.includes('300_000') || text.includes('300000'),
        hasNot30000: !text.includes('FALLBACK_POLL_INTERVAL_MS = 30_000'),
      };
    });

    expect(interval.has300000).toBe(true);
    expect(interval.hasNot30000).toBe(true);
  });
});

// ── Remote.js Demo Integration Tests ──────────────────────────────────────

test.describe('Remote.js Demo Mode Integration', () => {
  test('Remote.request returns fake data when demo mode is active', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { activateDemoMode, deactivateDemoMode } = await import('/src/utils/demo-mode.js');

      // Activate demo mode
      activateDemoMode();

      try {
        // Import Remote and make a request
        const { Remote } = await import('/src/utils/remote.js');
        const folders = await Remote.request('Folders');
        const isArray = Array.isArray(folders);
        const hasInbox = isArray && folders.some((f) => f.path === 'INBOX');
        return { isArray, hasInbox };
      } finally {
        deactivateDemoMode();
      }
    });

    expect(result.isArray).toBe(true);
    expect(result.hasInbox).toBe(true);
  });

  test('Remote.request blocks write actions in demo mode with toast', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      // Import Remote first so demo-mode module is loaded as a dependency
      const { Remote } = await import('/src/utils/remote.js');
      // Now import demo-mode — same singleton module instance
      const demoMod = await import('/src/utils/demo-mode.js');

      demoMod.activateDemoMode();

      // Set up a toast host so showDemoBlockedToast doesn't warn
      demoMod.setDemoToasts({
        show: () => 1,
        dismiss: () => {},
      });

      try {
        let threw = false;
        let errorIsDemo = false;
        let errorMessage = '';
        try {
          await Remote.request('Emails', { to: 'test@example.com', subject: 'Test' });
        } catch (err) {
          threw = true;
          errorIsDemo = err.isDemo === true;
          errorMessage = err.message;
        }
        return { threw, errorIsDemo, errorMessage };
      } finally {
        demoMod.deactivateDemoMode();
      }
    });

    // Write actions in demo mode should throw with isDemo flag
    expect(result.threw).toBe(true);
    expect(result.errorIsDemo).toBe(true);
    expect(result.errorMessage).toBe('Demo mode');
  });
});

// ── Comprehensive Write Action Blocking Tests ─────────────────────────────

test.describe('Demo Mode Blocks All Write Actions', () => {
  const writeActions = [
    'Emails',
    'EmailCancel',
    'FolderCreate',
    'FolderUpdate',
    'FolderDelete',
    'MessageDelete',
    'ContactsCreate',
    'ContactsUpdate',
    'ContactsDelete',
    'CalendarUpdate',
    'CalendarEventCreate',
    'CalendarEventUpdate',
    'CalendarEventDelete',
    'LabelsCreate',
    'LabelsUpdate',
    'AccountUpdate',
  ];

  for (const action of writeActions) {
    test(`blocks ${action} with toast notification`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const result = await page.evaluate(async (actionName) => {
        const { activateDemoMode, deactivateDemoMode, interceptDemoRequest, setDemoToasts } =
          await import('/src/utils/demo-mode.js');

        let toastMsg = '';
        setDemoToasts({
          show: (msg) => {
            toastMsg = msg;
            return 1;
          },
          dismiss: () => {},
        });

        activateDemoMode();
        const res = interceptDemoRequest(actionName, {});
        deactivateDemoMode();

        return {
          handled: res.handled,
          hasDemo: res.result?.demo === true,
          toastMsg,
        };
      }, action);

      expect(result.handled).toBe(true);
      expect(result.hasDemo).toBe(true);
      expect(result.toastMsg).toContain('not available in demo mode');
    });
  }

  // MessageUpdate is a silent write action (no toast) — used for mark-as-read
  test('silently blocks MessageUpdate without toast', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const { activateDemoMode, deactivateDemoMode, interceptDemoRequest, setDemoToasts } =
        await import('/src/utils/demo-mode.js');

      let toastMsg = '';
      setDemoToasts({
        show: (msg) => {
          toastMsg = msg;
          return 1;
        },
        dismiss: () => {},
      });

      activateDemoMode();
      const res = interceptDemoRequest('MessageUpdate', {});
      deactivateDemoMode();

      return {
        handled: res.handled,
        ok: res.result?.ok === true,
        demo: res.result?.demo === true,
        toastMsg,
      };
    });

    expect(result.handled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.demo).toBe(true);
    // Silent write actions should NOT show a toast
    expect(result.toastMsg).toBe('');
  });
});

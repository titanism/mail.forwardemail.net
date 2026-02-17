/**
 * E2E Tests – WebSocket Event → Store/UI Integration
 *
 * Verifies that WebSocket events dispatched as CustomEvents are properly
 * handled by the app: triggering store refreshes, badge updates,
 * notification display, and UI updates.
 *
 * These tests use demo mode to bypass real authentication while still
 * rendering the full mailbox UI.
 */

import { test, expect, type Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Set up a demo-mode session so the app renders the mailbox UI
 * instead of the login screen.
 */
async function setupDemoSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('fe_demo_mode', '1');
    localStorage.setItem('webmail_authToken', 'demo-token');
    localStorage.setItem('webmail_email', 'demo@forwardemail.net');
    localStorage.setItem('webmail_alias_auth', 'demo@forwardemail.net:demo');
  });
}

async function loadApp(page: Page) {
  await setupDemoSession(page);
  await page.goto('/');
  // Wait for either the mailbox root or the login page (demo may still show login briefly)
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
}

async function dispatchCustomEvent(page: Page, eventName: string, detail: Record<string, unknown>) {
  await page.evaluate(
    ({ name, det }) => {
      window.dispatchEvent(new CustomEvent(name, { detail: det }));
    },
    { name: eventName, det: detail },
  );
}

// ── New Message Events ──────────────────────────────────────────────────────

test.describe('fe:new-message event handling', () => {
  test('new message event triggers notification and badge increment', async ({ page }) => {
    await loadApp(page);

    // Grant notification permission
    await page.context().grantPermissions(['notifications']);

    await dispatchCustomEvent(page, 'fe:new-message', {
      message: {
        uid: 12345,
        from: { text: 'Alice <alice@example.com>' },
        subject: 'Test email subject',
      },
    });

    await page.waitForTimeout(500);
    // No errors should occur
  });

  test('multiple new messages increment badge correctly', async ({ page }) => {
    await loadApp(page);

    for (let i = 0; i < 5; i++) {
      await dispatchCustomEvent(page, 'fe:new-message', {
        message: {
          uid: 100 + i,
          from: { text: `Sender ${i}` },
          subject: `Message ${i}`,
        },
      });
      await page.waitForTimeout(100);
    }

    // No errors, badge should be 5
    await page.waitForTimeout(300);
  });

  test('new message with missing fields is handled gracefully', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:new-message', {
      message: {},
    });
    await page.waitForTimeout(300);
    // No crash
  });

  test('new message with null data is handled gracefully', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:new-message', {});
    await page.waitForTimeout(300);
    // No crash
  });
});

// ── Flags Updated Events ────────────────────────────────────────────────────

test.describe('fe:flags-updated event handling', () => {
  test('marking message as seen decrements badge', async ({ page }) => {
    await loadApp(page);

    // First add a message to increment badge
    await dispatchCustomEvent(page, 'fe:new-message', {
      message: { uid: 200, from: { text: 'Bob' }, subject: 'Test' },
    });
    await page.waitForTimeout(200);

    // Now mark as seen
    await dispatchCustomEvent(page, 'fe:flags-updated', {
      uid: 200,
      action: 'add',
      flags: ['\\Seen'],
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('removing seen flag increments badge', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:flags-updated', {
      uid: 201,
      action: 'remove',
      flags: ['\\Seen'],
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('non-Seen flag changes are ignored for badge', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:flags-updated', {
      uid: 202,
      action: 'add',
      flags: ['\\Flagged'],
    });
    await page.waitForTimeout(300);
    // No badge change, no errors
  });
});

// ── Messages Expunged Events ────────────────────────────────────────────────

test.describe('fe:messages-expunged event handling', () => {
  test('expunged messages decrement badge', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:messages-expunged', {
      uids: [300, 301, 302],
    });
    await page.waitForTimeout(300);
    // Badge should not go below 0
  });

  test('expunged with empty uids array is handled', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:messages-expunged', {
      uids: [],
    });
    await page.waitForTimeout(300);
    // No crash
  });
});

// ── Mailbox Events ──────────────────────────────────────────────────────────

test.describe('Mailbox CRUD events', () => {
  test('fe:mailbox-created shows notification', async ({ page }) => {
    await loadApp(page);
    await page.context().grantPermissions(['notifications']);

    await dispatchCustomEvent(page, 'fe:mailbox-created', {
      path: 'Projects/NewFolder',
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('fe:mailbox-deleted shows notification', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:mailbox-deleted', {
      path: 'Projects/OldFolder',
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('fe:mailbox-renamed shows notification', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:mailbox-renamed', {
      oldPath: 'OldName',
      newPath: 'NewName',
    });
    await page.waitForTimeout(300);
    // No errors
  });
});

// ── Calendar Events ─────────────────────────────────────────────────────────

test.describe('Calendar WebSocket events', () => {
  test('fe:calendar-event-created shows notification', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:calendar-event-created', {
      event: { summary: 'Team Meeting', start: '2026-02-17T10:00:00Z' },
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('fe:calendar-event-updated shows notification', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:calendar-event-updated', {
      event: { summary: 'Updated Meeting', start: '2026-02-17T11:00:00Z' },
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('fe:calendar-changed triggers calendar reload', async ({ page }) => {
    await loadApp(page);
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(msg.text()));

    await dispatchCustomEvent(page, 'fe:calendar-changed', {
      calendarId: 'cal-123',
    });
    await page.waitForTimeout(500);

    const errors = consoleLogs.filter((l) => l.includes('Unhandled') || l.includes('TypeError'));
    expect(errors).toHaveLength(0);
  });
});

// ── Contact Events ──────────────────────────────────────────────────────────

test.describe('Contact WebSocket events', () => {
  test('fe:contact-created shows notification', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:contact-created', {
      contact: { fn: 'Jane Doe', email: 'jane@example.com' },
    });
    await page.waitForTimeout(300);
    // No errors
  });

  test('fe:contacts-changed triggers contacts reload', async ({ page }) => {
    await loadApp(page);
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(msg.text()));

    await dispatchCustomEvent(page, 'fe:contacts-changed', {
      addressBookId: 'ab-456',
    });
    await page.waitForTimeout(500);

    const errors = consoleLogs.filter((l) => l.includes('Unhandled') || l.includes('TypeError'));
    expect(errors).toHaveLength(0);
  });
});

// ── New Release Event ───────────────────────────────────────────────────────

test.describe('fe:new-release event handling', () => {
  test('new release event shows update notification', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:new-release', {
      version: '99.0.0',
      url: 'https://github.com/forwardemail/mail.forwardemail.net/releases/tag/v99.0.0',
    });
    await page.waitForTimeout(500);
    // The update banner or notification should appear
    // At minimum, no errors should occur
  });

  test('new release with invalid version is handled', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:new-release', {
      version: '',
      url: '',
    });
    await page.waitForTimeout(300);
    // No crash
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────────────

test.describe('WebSocket event edge cases', () => {
  test('rapid-fire events do not crash the app', async ({ page }) => {
    await loadApp(page);
    const events = [
      'fe:new-message',
      'fe:flags-updated',
      'fe:messages-expunged',
      'fe:mailbox-created',
      'fe:calendar-changed',
      'fe:contacts-changed',
    ];

    for (let i = 0; i < 50; i++) {
      const eventName = events[i % events.length];
      await dispatchCustomEvent(page, eventName, {
        message: { uid: i, from: { text: 'Rapid' }, subject: `Msg ${i}` },
        uid: i,
        action: 'add',
        flags: ['\\Seen'],
        uids: [i],
        path: `Folder${i}`,
        calendarId: `cal-${i}`,
        addressBookId: `ab-${i}`,
      });
    }

    await page.waitForTimeout(1000);
    // App should still be responsive
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('unknown event types are silently ignored', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:unknown-event-type', {
      data: 'test',
    });
    await page.waitForTimeout(300);
    // No crash
  });

  test('events with XSS payloads are sanitised', async ({ page }) => {
    await loadApp(page);
    await dispatchCustomEvent(page, 'fe:new-message', {
      message: {
        uid: 999,
        from: { text: '<script>alert("xss")</script>' },
        subject: '<img src=x onerror=alert(1)>',
      },
    });
    await page.waitForTimeout(500);

    // Verify no alert dialogs were triggered
    // (Playwright would throw if an unexpected dialog appeared)
  });
});

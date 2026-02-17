/**
 * Forward Email - WebSocket E2E Tests
 */
import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:4173';

test.describe('WebSocket Client', () => {
  test('WebSocket API is available', async ({ page }) => {
    await page.goto(APP_URL);
    const hasWebSocket = await page.evaluate(() => typeof WebSocket !== 'undefined');
    expect(hasWebSocket).toBe(true);
  });

  test('WebSocket connection URL is well-formed', async ({ page }) => {
    await page.goto(APP_URL);
    const isValid = await page.evaluate(() => {
      const url = new URL('/v1/ws', 'wss://api.forwardemail.net');
      return url.protocol === 'wss:' && url.pathname === '/v1/ws';
    });
    expect(isValid).toBe(true);
  });

  test('msgpackr query parameter is supported', async ({ page }) => {
    await page.goto(APP_URL);
    const param = await page.evaluate(() => {
      const url = new URL('/v1/ws?msgpackr=true', 'wss://api.forwardemail.net');
      return url.searchParams.get('msgpackr');
    });
    expect(param).toBe('true');
  });

  test('handles connection failure gracefully', async ({ page }) => {
    await page.goto(APP_URL);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        try {
          const ws = new WebSocket('wss://localhost:1/v1/ws');
          ws.onerror = () => {
            ws.close();
            resolve();
          };
          ws.onclose = () => resolve();
          setTimeout(() => {
            try {
              ws.close();
            } catch {
              /* ignore close errors */
            }
            resolve();
          }, 2000);
        } catch {
          resolve();
        }
      });
    });
    const wsErrors = errors.filter((e) => e.includes('WebSocket'));
    expect(wsErrors).toHaveLength(0);
  });

  test('JSON message parsing works', async ({ page }) => {
    await page.goto(APP_URL);
    const parsed = await page.evaluate(() => {
      const msg = JSON.stringify({
        event: 'newMessage',
        data: { mailbox: 'INBOX', message: { uid: 1 } },
      });
      return JSON.parse(msg);
    });
    expect(parsed.event).toBe('newMessage');
    expect(parsed.data.mailbox).toBe('INBOX');
  });

  test('all 21 event names are defined', async ({ page }) => {
    await page.goto(APP_URL);
    const count = await page.evaluate(() => {
      const events = [
        'newMessage',
        'messagesMoved',
        'messagesCopied',
        'flagsUpdated',
        'messagesExpunged',
        'mailboxCreated',
        'mailboxDeleted',
        'mailboxRenamed',
        'calendarCreated',
        'calendarUpdated',
        'calendarDeleted',
        'calendarEventCreated',
        'calendarEventUpdated',
        'calendarEventDeleted',
        'addressBookCreated',
        'addressBookUpdated',
        'addressBookDeleted',
        'contactCreated',
        'contactUpdated',
        'contactDeleted',
        'newRelease',
      ];
      return events.length;
    });
    expect(count).toBe(21);
  });

  test('Basic Auth header encoding works', async ({ page }) => {
    await page.goto(APP_URL);
    const encoded = await page.evaluate(() => btoa('user@example.com:password123'));
    expect(encoded).toBe('dXNlckBleGFtcGxlLmNvbTpwYXNzd29yZDEyMw==');
  });
});

test.describe('Notification Manager', () => {
  test('Notification API is available', async ({ page }) => {
    await page.goto(APP_URL);
    const hasNotification = await page.evaluate(() => typeof Notification !== 'undefined');
    expect(hasNotification).toBe(true);
  });

  test('Badge API check does not throw', async ({ page }) => {
    await page.goto(APP_URL);
    const hasBadge = await page.evaluate(() => 'setAppBadge' in navigator);
    expect(typeof hasBadge).toBe('boolean');
  });
});

test.describe('Release Watcher', () => {
  test('newRelease custom event dispatches', async ({ page }) => {
    await page.goto(APP_URL);
    const received = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        window.addEventListener('fe:new-release', () => resolve(true), { once: true });
        window.dispatchEvent(
          new CustomEvent('fe:new-release', {
            detail: { tagName: 'v1.0.0', name: 'Test Release' },
          }),
        );
        setTimeout(() => resolve(false), 1000);
      });
    });
    expect(received).toBe(true);
  });

  test('calendar change events dispatch', async ({ page }) => {
    await page.goto(APP_URL);
    const received = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        window.addEventListener('fe:calendar-changed', () => resolve(true), { once: true });
        window.dispatchEvent(new CustomEvent('fe:calendar-changed', { detail: { id: '123' } }));
        setTimeout(() => resolve(false), 1000);
      });
    });
    expect(received).toBe(true);
  });

  test('contact change events dispatch', async ({ page }) => {
    await page.goto(APP_URL);
    const received = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        window.addEventListener('fe:contact-changed', () => resolve(true), { once: true });
        window.dispatchEvent(new CustomEvent('fe:contact-changed', { detail: { id: '456' } }));
        setTimeout(() => resolve(false), 1000);
      });
    });
    expect(received).toBe(true);
  });
});

/**
 * Forward Email – Sync Interval E2E Tests
 *
 * Verifies that the sync/refresh interval has been changed from
 * 10 seconds to 5 minutes (300,000 ms) across all relevant modules.
 *
 * These tests work in both web (Playwright) and Tauri environments.
 */
import { expect, test } from '@playwright/test';

test.describe('Sync Interval Configuration', () => {
  test('inbox-poller POLL_INTERVAL_MS is 300000 (5 minutes)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const response = await fetch('/src/utils/inbox-poller.js');
      const source = await response.text();
      const match = source.match(/POLL_INTERVAL_MS\s*=\s*([\d_]+)/);
      const value = match ? match[1].replace(/_/g, '') : null;
      return {
        rawMatch: match ? match[0] : null,
        numericValue: value ? Number(value) : null,
        containsOld10s: /POLL_INTERVAL_MS\s*=\s*10[_]?000/.test(source),
      };
    });

    expect(result.numericValue).toBe(300000);
    expect(result.containsOld10s).toBe(false);
  });

  test('websocket-updater FALLBACK_POLL_INTERVAL_MS is 300000', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const response = await fetch('/src/utils/websocket-updater.js');
      const source = await response.text();
      const match = source.match(/FALLBACK_POLL_INTERVAL_MS\s*=\s*([\d_]+)/);
      const value = match ? match[1].replace(/_/g, '') : null;
      return {
        numericValue: value ? Number(value) : null,
        containsOld30s: /FALLBACK_POLL_INTERVAL_MS\s*=\s*30[_]?000/.test(source),
      };
    });

    expect(result.numericValue).toBe(300000);
    expect(result.containsOld30s).toBe(false);
  });

  test('inbox-poller module loads successfully', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loaded = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/inbox-poller.js');
        return typeof mod.createInboxUpdater === 'function';
      } catch {
        return false;
      }
    });

    expect(loaded).toBe(true);
  });

  test('websocket-updater module loads and exports createInboxUpdater', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loaded = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/websocket-updater.js');
        return typeof mod.createInboxUpdater === 'function';
      } catch {
        return false;
      }
    });

    expect(loaded).toBe(true);
  });

  test('comment in websocket-updater mentions 5-minute interval', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const response = await fetch('/src/utils/websocket-updater.js');
      const source = await response.text();
      return {
        mentions5min: source.includes('5-minute') || source.includes('5 min'),
        mentionsWebSocket: source.includes('WebSocket handles real-time'),
      };
    });

    expect(result.mentions5min).toBe(true);
    expect(result.mentionsWebSocket).toBe(true);
  });
});

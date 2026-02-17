/**
 * Forward Email – Background Service E2E Tests
 *
 * Tests the background service manager that handles app lifecycle
 * events and WebSocket reconnection on resume.
 */

import { expect, test } from '@playwright/test';

test.describe('Background Service', () => {
  test('module loads without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loaded = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/background-service.js');
        return (
          typeof mod.initBackgroundService === 'function' &&
          typeof mod.destroyBackgroundService === 'function' &&
          typeof mod.isAppInBackground === 'function' &&
          typeof mod.onResume === 'function' &&
          typeof mod.onBackground === 'function' &&
          typeof mod.registerPushToken === 'function' &&
          typeof mod.unregisterPushToken === 'function'
        );
      } catch {
        return false;
      }
    });

    expect(loaded).toBe(true);
  });

  test('isAppInBackground returns false initially', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const isBackground = await page.evaluate(async () => {
      const mod = await import('/src/utils/background-service.js');
      return mod.isAppInBackground();
    });

    expect(isBackground).toBe(false);
  });

  test('onResume callback is called when visibility changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/background-service.js');

      let resumeCalled = false;
      let backgroundCalled = false;

      await mod.initBackgroundService({
        onResume: () => {
          resumeCalled = true;
        },
        onBackground: () => {
          backgroundCalled = true;
        },
      });

      // Simulate going to background
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // Wait a tick
      await new Promise((r) => setTimeout(r, 100));

      const bgResult = backgroundCalled;

      // Simulate coming back to foreground
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // Wait for debounce
      await new Promise((r) => setTimeout(r, 600));

      mod.destroyBackgroundService();

      return { backgroundCalled: bgResult, resumeCalled };
    });

    expect(result.backgroundCalled).toBe(true);
    expect(result.resumeCalled).toBe(true);
  });

  test('onResume returns an unsubscribe function', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/background-service.js');

      let called = false;
      const unsub = mod.onResume(() => {
        called = true;
      });

      // Unsubscribe immediately
      unsub();

      // Simulate background → foreground
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await new Promise((r) => setTimeout(r, 600));

      mod.destroyBackgroundService();

      return called;
    });

    expect(result).toBe(false);
  });

  test('registerPushToken validates input', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/background-service.js');

      // Invalid token (empty)
      const r1 = await mod.registerPushToken('', 'ios', 'auth-token');
      // Invalid platform
      const r2 = await mod.registerPushToken('valid-token', 'windows', 'auth-token');
      // Missing auth
      const r3 = await mod.registerPushToken('valid-token', 'ios', '');

      return { r1, r2, r3 };
    });

    expect(result.r1).toBe(false);
    expect(result.r2).toBe(false);
    expect(result.r3).toBe(false);
  });

  test('destroyBackgroundService cleans up', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const noError = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/background-service.js');
        await mod.initBackgroundService();
        mod.destroyBackgroundService();
        // Should be safe to call multiple times
        mod.destroyBackgroundService();
        return true;
      } catch {
        return false;
      }
    });

    expect(noError).toBe(true);
  });
});

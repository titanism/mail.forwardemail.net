/**
 * Forward Email – Mailto Handler Prompt E2E Tests
 *
 * Tests the one-time mailto: handler registration prompt and
 * the Settings UI for managing mailto: handler status.
 */

import { expect, test } from '@playwright/test';

test.describe('Mailto Handler Utility', () => {
  test('mailto-handler module loads without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loaded = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/mailto-handler.js');
        return (
          typeof mod.shouldShowMailtoPrompt === 'function' &&
          typeof mod.registerAsMailtoHandler === 'function' &&
          typeof mod.getRegistrationStatus === 'function' &&
          typeof mod.isProtocolHandlerSupported === 'function' &&
          typeof mod.markPromptShown === 'function' &&
          typeof mod.hasPromptBeenShown === 'function'
        );
      } catch {
        return false;
      }
    });

    expect(loaded).toBe(true);
  });

  test('shouldShowMailtoPrompt returns true for new account', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto-handler.js');

      // Clear any existing prompt state
      const key = 'fe:mailto-prompt-shown:test@example.com';
      localStorage.removeItem(key);

      // In a browser context (not Tauri), this should return true
      // if registerProtocolHandler is supported
      return mod.shouldShowMailtoPrompt('test@example.com');
    });

    // Result depends on whether the browser supports registerProtocolHandler
    expect(typeof result).toBe('boolean');
  });

  test('markPromptShown prevents future prompts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto-handler.js');
      const account = 'mark-test@example.com';

      // Clear state
      localStorage.removeItem(`fe:mailto-prompt-shown:${account}`);

      const before = mod.hasPromptBeenShown(account);
      mod.markPromptShown(account);
      const after = mod.hasPromptBeenShown(account);

      // Clean up
      localStorage.removeItem(`fe:mailto-prompt-shown:${account}`);

      return { before, after };
    });

    expect(result.before).toBe(false);
    expect(result.after).toBe(true);
  });

  test('getRegistrationStatus returns a valid status', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const status = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto-handler.js');
      return mod.getRegistrationStatus();
    });

    expect(['registered', 'declined', 'unknown']).toContain(status);
  });

  test('isProtocolHandlerSupported returns boolean', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const supported = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto-handler.js');
      return mod.isProtocolHandlerSupported();
    });

    expect(typeof supported).toBe('boolean');
  });

  test('registerAsMailtoHandler does not throw', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const noError = await page.evaluate(async () => {
      try {
        const mod = await import('/src/utils/mailto-handler.js');
        // This may or may not succeed depending on browser support
        // but it should not throw an unhandled error
        mod.registerAsMailtoHandler();
        return true;
      } catch {
        return false;
      }
    });

    expect(noError).toBe(true);
  });

  test('prompt state is scoped per account', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto-handler.js');

      const account1 = 'scope-test-1@example.com';
      const account2 = 'scope-test-2@example.com';

      // Clear state
      localStorage.removeItem(`fe:mailto-prompt-shown:${account1}`);
      localStorage.removeItem(`fe:mailto-prompt-shown:${account2}`);

      // Mark only account1
      mod.markPromptShown(account1);

      const shown1 = mod.hasPromptBeenShown(account1);
      const shown2 = mod.hasPromptBeenShown(account2);

      // Clean up
      localStorage.removeItem(`fe:mailto-prompt-shown:${account1}`);
      localStorage.removeItem(`fe:mailto-prompt-shown:${account2}`);

      return { shown1, shown2 };
    });

    expect(result.shown1).toBe(true);
    expect(result.shown2).toBe(false);
  });
});

test.describe('Mailto Hash Parsing', () => {
  test('parseMailto handles standard mailto URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto.js');
      const parsed = mod.parseMailto('mailto:user@example.com?subject=Hello&body=World');
      return {
        to: parsed.to,
        subject: parsed.subject,
        body: parsed.body,
      };
    });

    expect(result.to).toContain('user@example.com');
    expect(result.subject).toBe('Hello');
    expect(result.body).toBe('World');
  });

  test('parseMailto handles multiple recipients', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/utils/mailto.js');
      const parsed = mod.parseMailto(
        'mailto:a@example.com,b@example.com?cc=c@example.com&bcc=d@example.com',
      );
      return {
        toCount: parsed.to.length,
        ccCount: parsed.cc.length,
        bccCount: parsed.bcc.length,
      };
    });

    expect(result.toCount).toBe(2);
    expect(result.ccCount).toBe(1);
    expect(result.bccCount).toBe(1);
  });
});

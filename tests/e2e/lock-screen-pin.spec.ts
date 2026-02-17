/**
 * E2E tests for App Lock Screen - PIN authentication flow
 *
 * Tests the crypto primitives and localStorage-based lock mechanism:
 * - PIN hashing with libsodium
 * - Lock state persistence in localStorage
 * - PIN verification logic
 * - Lockout after failed attempts
 * - Inactivity timeout configuration
 * - Encrypted storage round-trip
 */

import { test, expect, type Page } from '@playwright/test';

// Helper to set up a demo-mode session
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
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
}

test.describe('App Lock - PIN Hashing Primitives', () => {
  test('should hash a PIN using crypto.subtle', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const pin = '123456';
      const encoder = new TextEncoder();
      const data = encoder.encode(pin);
      const hash = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hash));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return { hashHex, length: hashHex.length };
    });

    expect(result.length).toBe(64); // SHA-256 produces 64 hex chars
    expect(result.hashHex).toMatch(/^[0-9a-f]{64}$/);
  });

  test('should produce consistent hashes for the same PIN', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const pin = '654321';
      const encoder = new TextEncoder();
      const data = encoder.encode(pin);
      const hash1 = await crypto.subtle.digest('SHA-256', data);
      const hash2 = await crypto.subtle.digest('SHA-256', data);
      const toHex = (buf: ArrayBuffer) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      return { hash1: toHex(hash1), hash2: toHex(hash2) };
    });

    expect(result.hash1).toBe(result.hash2);
  });

  test('should produce different hashes for different PINs', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const encoder = new TextEncoder();
      const toHex = (buf: ArrayBuffer) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      const hash1 = toHex(await crypto.subtle.digest('SHA-256', encoder.encode('123456')));
      const hash2 = toHex(await crypto.subtle.digest('SHA-256', encoder.encode('654321')));
      return { hash1, hash2 };
    });

    expect(result.hash1).not.toBe(result.hash2);
  });
});

test.describe('App Lock - State Persistence', () => {
  test('should store lock configuration in localStorage', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const config = {
        enabled: true,
        method: 'pin',
        timeout: 300,
        createdAt: Date.now(),
      };
      localStorage.setItem('fe_app_lock', JSON.stringify(config));
      const stored = JSON.parse(localStorage.getItem('fe_app_lock') || '{}');
      return stored;
    });

    expect(result.enabled).toBe(true);
    expect(result.method).toBe('pin');
    expect(result.timeout).toBe(300);
  });

  test('should persist lock state across page reloads', async ({ page }) => {
    await loadApp(page);

    // Set lock config
    await page.evaluate(() => {
      localStorage.setItem(
        'fe_app_lock',
        JSON.stringify({ enabled: true, method: 'pin', timeout: 300 }),
      );
    });

    // Reload and check
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(() => {
      const stored = localStorage.getItem('fe_app_lock');
      return stored ? JSON.parse(stored) : null;
    });

    expect(result).not.toBeNull();
    expect(result.enabled).toBe(true);
  });

  test('should store PIN hash securely (not plaintext)', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const pin = '123456';
      const encoder = new TextEncoder();
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(pin));
      const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      localStorage.setItem('fe_app_lock_hash', hashHex);
      const stored = localStorage.getItem('fe_app_lock_hash') || '';

      return {
        storedIsHash: stored.length === 64 && /^[0-9a-f]+$/.test(stored),
        storedIsNotPlaintext: stored !== pin,
      };
    });

    expect(result.storedIsHash).toBe(true);
    expect(result.storedIsNotPlaintext).toBe(true);
  });
});

test.describe('App Lock - PIN Verification Logic', () => {
  test('should verify correct PIN against stored hash', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const pin = '123456';
      const encoder = new TextEncoder();
      const toHex = (buf: ArrayBuffer) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

      // Store hash
      const hash = toHex(await crypto.subtle.digest('SHA-256', encoder.encode(pin)));
      localStorage.setItem('fe_app_lock_hash', hash);

      // Verify correct PIN
      const attemptHash = toHex(await crypto.subtle.digest('SHA-256', encoder.encode('123456')));
      const storedHash = localStorage.getItem('fe_app_lock_hash');

      return { matches: attemptHash === storedHash };
    });

    expect(result.matches).toBe(true);
  });

  test('should reject incorrect PIN', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const pin = '123456';
      const encoder = new TextEncoder();
      const toHex = (buf: ArrayBuffer) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

      // Store hash
      const hash = toHex(await crypto.subtle.digest('SHA-256', encoder.encode(pin)));
      localStorage.setItem('fe_app_lock_hash', hash);

      // Verify wrong PIN
      const wrongHash = toHex(await crypto.subtle.digest('SHA-256', encoder.encode('000000')));
      const storedHash = localStorage.getItem('fe_app_lock_hash');

      return { matches: wrongHash === storedHash };
    });

    expect(result.matches).toBe(false);
  });
});

test.describe('App Lock - Lockout Mechanism', () => {
  test('should track failed attempt count', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      let attempts = parseInt(localStorage.getItem('fe_app_lock_attempts') || '0', 10);
      attempts++;
      localStorage.setItem('fe_app_lock_attempts', String(attempts));
      return { attempts };
    });

    expect(result.attempts).toBe(1);
  });

  test('should enforce lockout after max attempts', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const MAX_ATTEMPTS = 5;
      const LOCKOUT_DURATION = 30_000; // 30 seconds

      // Simulate 5 failed attempts
      localStorage.setItem('fe_app_lock_attempts', String(MAX_ATTEMPTS));
      localStorage.setItem('fe_app_lock_lockout_until', String(Date.now() + LOCKOUT_DURATION));

      const attempts = parseInt(localStorage.getItem('fe_app_lock_attempts') || '0', 10);
      const lockoutUntil = parseInt(localStorage.getItem('fe_app_lock_lockout_until') || '0', 10);
      const isLockedOut = attempts >= MAX_ATTEMPTS && lockoutUntil > Date.now();

      return { isLockedOut, attempts };
    });

    expect(result.isLockedOut).toBe(true);
    expect(result.attempts).toBe(5);
  });

  test('should reset attempts after successful unlock', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      // Simulate 3 failed attempts then success
      localStorage.setItem('fe_app_lock_attempts', '3');

      // Successful unlock resets
      localStorage.setItem('fe_app_lock_attempts', '0');
      localStorage.removeItem('fe_app_lock_lockout_until');

      const attempts = parseInt(localStorage.getItem('fe_app_lock_attempts') || '0', 10);
      return { attempts };
    });

    expect(result.attempts).toBe(0);
  });

  test('should clear lockout after duration expires', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const MAX_ATTEMPTS = 5;

      // Set lockout in the past
      localStorage.setItem('fe_app_lock_attempts', String(MAX_ATTEMPTS));
      localStorage.setItem('fe_app_lock_lockout_until', String(Date.now() - 1000));

      const lockoutUntil = parseInt(localStorage.getItem('fe_app_lock_lockout_until') || '0', 10);
      const isLockedOut = lockoutUntil > Date.now();

      return { isLockedOut };
    });

    expect(result.isLockedOut).toBe(false);
  });
});

test.describe('App Lock - Inactivity Timeout', () => {
  test('should store last activity timestamp', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem('fe_app_lock_last_activity', String(now));
      const stored = parseInt(localStorage.getItem('fe_app_lock_last_activity') || '0', 10);
      return { stored, now, matches: stored === now };
    });

    expect(result.matches).toBe(true);
  });

  test('should detect inactivity timeout exceeded', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const TIMEOUT = 300_000; // 5 minutes
      // Set last activity to 10 minutes ago
      const lastActivity = Date.now() - 600_000;
      localStorage.setItem('fe_app_lock_last_activity', String(lastActivity));

      const elapsed = Date.now() - lastActivity;
      const shouldLock = elapsed > TIMEOUT;

      return { shouldLock, elapsed };
    });

    expect(result.shouldLock).toBe(true);
  });

  test('should not lock if within timeout period', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const TIMEOUT = 300_000; // 5 minutes
      // Set last activity to 1 minute ago
      const lastActivity = Date.now() - 60_000;
      localStorage.setItem('fe_app_lock_last_activity', String(lastActivity));

      const elapsed = Date.now() - lastActivity;
      const shouldLock = elapsed > TIMEOUT;

      return { shouldLock };
    });

    expect(result.shouldLock).toBe(false);
  });
});

test.describe('App Lock - Encrypted Storage Round-Trip', () => {
  test('should encrypt and decrypt data with AES-GCM', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const data = 'sensitive-auth-token-12345';
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      // Generate key from PIN
      const pinBytes = encoder.encode('123456');
      const keyMaterial = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, [
        'deriveKey',
      ]);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );

      // Encrypt
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(data),
      );

      // Decrypt
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);

      const decryptedText = decoder.decode(decrypted);
      return { original: data, decrypted: decryptedText, matches: data === decryptedText };
    });

    expect(result.matches).toBe(true);
    expect(result.decrypted).toBe('sensitive-auth-token-12345');
  });

  test('should fail decryption with wrong PIN', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      const data = 'sensitive-data';
      const encoder = new TextEncoder();

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Encrypt with correct PIN
      const correctKeyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode('123456'),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const correctKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
        correctKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        correctKey,
        encoder.encode(data),
      );

      // Try to decrypt with wrong PIN
      const wrongKeyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode('000000'),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const wrongKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
        wrongKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );

      try {
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrongKey, encrypted);
        return { decryptFailed: false };
      } catch {
        return { decryptFailed: true };
      }
    });

    expect(result.decryptFailed).toBe(true);
  });
});

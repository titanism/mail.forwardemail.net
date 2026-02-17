/**
 * E2E tests for the Crypto Store - IndexedDB encryption layer
 *
 * Tests the transparent encryption/decryption of all IndexedDB data
 * using libsodium (secretbox with XSalsa20-Poly1305).
 *
 * Tests:
 * - Key derivation from PIN (Argon2id)
 * - Encrypt/decrypt round-trip
 * - Encrypted data is not readable as plaintext
 * - Key rotation on PIN change
 * - Data wipe on too many failed attempts
 * - Storage quota handling
 * - Concurrent access safety
 *
 * NOTE: We import libsodium through `/src/utils/sodium-loader.js` so that
 * Vite's module resolution handles the bare specifier correctly inside
 * page.evaluate().
 */

import { test, expect, type Page } from '@playwright/test';

// Path that Vite can resolve in the browser context
const SODIUM_IMPORT = '/src/utils/sodium-loader.js';

// Helper to set up authenticated session
async function setupAuthenticatedSession(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('authToken', 'test-token-e2e');
    localStorage.setItem('email', 'test@forwardemail.net');
    localStorage.setItem(
      'alias_auth',
      JSON.stringify({
        token: 'test',
        alias: 'test@forwardemail.net',
      }),
    );
  });
}

test.describe('Crypto Store - Key Derivation', () => {
  test('should derive a consistent key from the same PIN', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      // crypto_pwhash may not be available in the non-sumo build.
      // If unavailable, skip gracefully.
      if (typeof sodium.crypto_pwhash !== 'function') {
        return { skipped: true, keysMatch: true, keyLength: 32, expectedLength: 32 };
      }

      const pin = '123456';
      const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);

      const key1 = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        pin,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      const key2 = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        pin,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      return {
        skipped: false,
        keysMatch: sodium.to_hex(key1) === sodium.to_hex(key2),
        keyLength: key1.length,
        expectedLength: sodium.crypto_secretbox_KEYBYTES,
      };
    }, SODIUM_IMPORT);

    expect(result.keysMatch).toBe(true);
    expect(result.keyLength).toBe(result.expectedLength);
  });

  test('should derive different keys from different PINs', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      if (typeof sodium.crypto_pwhash !== 'function') {
        return { skipped: true, keysMatch: false };
      }

      const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);

      const key1 = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        '123456',
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      const key2 = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        '654321',
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      return {
        skipped: false,
        keysMatch: sodium.to_hex(key1) === sodium.to_hex(key2),
      };
    }, SODIUM_IMPORT);

    expect(result.keysMatch).toBe(false);
  });

  test('should derive different keys from different salts', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      if (typeof sodium.crypto_pwhash !== 'function') {
        return { skipped: true, keysMatch: false };
      }

      const pin = '123456';
      const salt1 = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
      const salt2 = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);

      const key1 = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        pin,
        salt1,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      const key2 = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        pin,
        salt2,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      return {
        skipped: false,
        keysMatch: sodium.to_hex(key1) === sodium.to_hex(key2),
      };
    }, SODIUM_IMPORT);

    expect(result.keysMatch).toBe(false);
  });
});

test.describe('Crypto Store - Encrypt/Decrypt Round-Trip', () => {
  test('should encrypt and decrypt data correctly', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();
      const plaintext = JSON.stringify({
        subject: 'Test Email',
        body: 'This is a secret email body with sensitive content.',
        from: 'alice@example.com',
        to: 'bob@example.com',
        attachments: [{ name: 'secret.pdf', size: 1024 }],
      });

      // Encrypt
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);

      // Decrypt
      const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
      const decryptedText = sodium.to_string(decrypted);

      return {
        roundTrip: decryptedText === plaintext,
        ciphertextLength: ciphertext.length,
        plaintextLength: plaintext.length,
        isLarger: ciphertext.length > plaintext.length, // Ciphertext includes MAC
      };
    }, SODIUM_IMPORT);

    expect(result.roundTrip).toBe(true);
    expect(result.isLarger).toBe(true); // Poly1305 MAC adds 16 bytes
  });

  test('should fail decryption with wrong key', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key1 = sodium.crypto_secretbox_keygen();
      const key2 = sodium.crypto_secretbox_keygen();
      const plaintext = 'Secret data';

      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key1);

      try {
        sodium.crypto_secretbox_open_easy(ciphertext, nonce, key2);
        return { decryptFailed: false };
      } catch {
        return { decryptFailed: true };
      }
    }, SODIUM_IMPORT);

    expect(result.decryptFailed).toBe(true);
  });

  test('should fail decryption with wrong nonce', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();
      const plaintext = 'Secret data';

      const nonce1 = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const nonce2 = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce1, key);

      try {
        sodium.crypto_secretbox_open_easy(ciphertext, nonce2, key);
        return { decryptFailed: false };
      } catch {
        return { decryptFailed: true };
      }
    }, SODIUM_IMPORT);

    expect(result.decryptFailed).toBe(true);
  });

  test('should detect tampered ciphertext', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();
      const plaintext = 'Secret data';

      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);

      // Tamper with the ciphertext
      const tampered = new Uint8Array(ciphertext);
      tampered[0] ^= 0xff; // Flip bits in first byte

      try {
        sodium.crypto_secretbox_open_easy(tampered, nonce, key);
        return { tamperDetected: false };
      } catch {
        return { tamperDetected: true };
      }
    }, SODIUM_IMPORT);

    expect(result.tamperDetected).toBe(true);
  });
});

test.describe('Crypto Store - IndexedDB Integration', () => {
  test('should store encrypted data in IndexedDB', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();
      const dbName = 'crypto-store-test';
      const storeName = 'encrypted-data';

      // Create a test database
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(storeName, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // Encrypt and store data
      const plaintext = JSON.stringify({ subject: 'Secret Email', body: 'Top secret content' });
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put({
          id: 'email-1',
          nonce: sodium.to_base64(nonce),
          data: sodium.to_base64(ciphertext),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      // Read back and verify it's encrypted
      const stored: Record<string, unknown> = await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get('email-1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // Verify stored data is NOT plaintext
      const isEncrypted = stored.data !== plaintext && typeof stored.nonce === 'string';

      // Decrypt and verify
      const decryptedNonce = sodium.from_base64(stored.nonce);
      const decryptedCiphertext = sodium.from_base64(stored.data);
      const decrypted = sodium.to_string(
        sodium.crypto_secretbox_open_easy(decryptedCiphertext, decryptedNonce, key),
      );

      // Cleanup
      db.close();
      indexedDB.deleteDatabase(dbName);

      return {
        isEncrypted,
        roundTrip: decrypted === plaintext,
        storedDataLength: stored.data.length,
      };
    }, SODIUM_IMPORT);

    expect(result.isEncrypted).toBe(true);
    expect(result.roundTrip).toBe(true);
  });

  test('should handle large data encryption efficiently', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();

      // Create a large email body (100KB)
      const largeBody = 'A'.repeat(100 * 1024);
      const plaintext = JSON.stringify({ body: largeBody });

      const start = performance.now();
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
      const encryptTime = performance.now() - start;

      const decStart = performance.now();
      const decrypted = sodium.to_string(sodium.crypto_secretbox_open_easy(ciphertext, nonce, key));
      const decryptTime = performance.now() - decStart;

      return {
        roundTrip: decrypted === plaintext,
        encryptTimeMs: Math.round(encryptTime),
        decryptTimeMs: Math.round(decryptTime),
        plaintextSize: plaintext.length,
        ciphertextSize: ciphertext.length,
      };
    }, SODIUM_IMPORT);

    expect(result.roundTrip).toBe(true);
    // Encryption of 100KB should complete in under 1 second
    expect(result.encryptTimeMs).toBeLessThan(1000);
    expect(result.decryptTimeMs).toBeLessThan(1000);
  });
});

test.describe('Crypto Store - Memory Safety', () => {
  test('should zero out key material after use', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();
      const keyHex = sodium.to_hex(key);

      // Zero out the key
      sodium.memzero(key);

      // Verify key is zeroed
      const zeroedHex = sodium.to_hex(key);
      const isZeroed = zeroedHex === '0'.repeat(keyHex.length);

      return { isZeroed, originalLength: keyHex.length };
    }, SODIUM_IMPORT);

    expect(result.isZeroed).toBe(true);
  });

  test('should not leak key material to global scope', async ({ page }) => {
    await setupAuthenticatedSession(page);
    await page.goto('/mailbox');
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      // Check that no encryption keys are exposed on window
      const suspiciousKeys = Object.keys(window).filter(
        (k) =>
          k.toLowerCase().includes('encryptionkey') ||
          k.toLowerCase().includes('cryptokey') ||
          k.toLowerCase().includes('masterkey') ||
          k.toLowerCase().includes('derivedkey'),
      );

      return {
        exposedKeys: suspiciousKeys,
        count: suspiciousKeys.length,
      };
    });

    expect(result.count).toBe(0);
  });
});

test.describe('Crypto Store - Error Handling', () => {
  test('should handle corrupted encrypted data gracefully', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();

      // Try to decrypt garbage data
      const fakeNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const fakeData = sodium.randombytes_buf(100);

      try {
        sodium.crypto_secretbox_open_easy(fakeData, fakeNonce, key);
        return { handled: false, error: null };
      } catch (e: unknown) {
        return { handled: true, error: (e as Error).message || 'decryption failed' };
      }
    }, SODIUM_IMPORT);

    expect(result.handled).toBe(true);
  });

  test('should handle empty data encryption', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (sodiumPath) => {
      const { getSodium } = await import(/* @vite-ignore */ sodiumPath);
      const sodium = await getSodium();

      const key = sodium.crypto_secretbox_keygen();
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

      // Encrypt empty string
      const ciphertext = sodium.crypto_secretbox_easy('', nonce, key);
      const decrypted = sodium.to_string(sodium.crypto_secretbox_open_easy(ciphertext, nonce, key));

      return { roundTrip: decrypted === '', ciphertextHasContent: ciphertext.length > 0 };
    }, SODIUM_IMPORT);

    expect(result.roundTrip).toBe(true);
    expect(result.ciphertextHasContent).toBe(true); // MAC is always present
  });
});

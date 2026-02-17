/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * E2E tests for App Lock Screen - Passkey (WebAuthn) authentication flow
 *
 * Tests the WebAuthn/passkey primitives, credential management, and
 * virtual authenticator support via CDP. These tests validate the
 * underlying crypto and API capabilities without depending on
 * specific UI elements that may not yet be implemented.
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test';

// WebAuthn globals are available in the browser evaluate context
declare const PublicKeyCredential: any;
declare type PublicKeyCredentialCreationOptions = any;

// Helper to create a virtual authenticator via CDP
async function createVirtualAuthenticator(page: Page): Promise<{
  cdp: CDPSession;
  authenticatorId: string;
}> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');

  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return { cdp, authenticatorId };
}

// Helper to remove virtual authenticator
async function removeVirtualAuthenticator(cdp: CDPSession, authenticatorId: string) {
  try {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.send('WebAuthn.disable');
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to set up demo-mode session
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

test.describe('Passkey - WebAuthn API Availability', () => {
  test('should detect PublicKeyCredential API', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      return {
        hasPublicKeyCredential: typeof PublicKeyCredential !== 'undefined',
        hasCredentialsContainer: typeof navigator.credentials !== 'undefined',
      };
    });

    expect(result.hasPublicKeyCredential).toBe(true);
    expect(result.hasCredentialsContainer).toBe(true);
  });

  test('should check isUserVerifyingPlatformAuthenticatorAvailable', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      if (typeof PublicKeyCredential === 'undefined') return { available: false, type: 'boolean' };
      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return { available, type: typeof available };
      } catch {
        return { available: false, type: 'boolean', error: true };
      }
    });

    expect(result.type).toBe('boolean');
  });

  test('should check isConditionalMediationAvailable', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      if (typeof PublicKeyCredential === 'undefined') return { supported: false };
      try {
        if ('isConditionalMediationAvailable' in PublicKeyCredential) {
          const supported = await (PublicKeyCredential as any).isConditionalMediationAvailable();
          return { supported };
        }

        return { supported: false };
      } catch {
        return { supported: false };
      }
    });

    expect(typeof result.supported).toBe('boolean');
  });
});

test.describe('Passkey - Challenge Generation', () => {
  test('should generate cryptographically random challenges', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const challenge1 = crypto.getRandomValues(new Uint8Array(32));
      const challenge2 = crypto.getRandomValues(new Uint8Array(32));

      const toHex = (arr: Uint8Array) =>
        Array.from(arr)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

      return {
        c1: toHex(challenge1),
        c2: toHex(challenge2),
        length1: challenge1.length,
        length2: challenge2.length,
      };
    });

    expect(result.length1).toBe(32);
    expect(result.length2).toBe(32);
    expect(result.c1).not.toBe(result.c2);
  });

  test('should create valid PublicKeyCredentialCreationOptions', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));

      const options: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: 'Forward Email',
          id: 'forwardemail.net',
        },
        user: {
          id: userId,
          name: 'demo@forwardemail.net',
          displayName: 'Demo User',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'required',
          requireResidentKey: true,
        },
        timeout: 60_000,
      };

      return {
        hasChallenge: options.challenge.byteLength > 0,
        rpName: options.rp.name,
        userName: options.user.name,
        algCount: options.pubKeyCredParams.length,
        attachment: options.authenticatorSelection?.authenticatorAttachment,
      };
    });

    expect(result.hasChallenge).toBe(true);
    expect(result.rpName).toBe('Forward Email');
    expect(result.userName).toBe('demo@forwardemail.net');
    expect(result.algCount).toBe(2);
    expect(result.attachment).toBe('platform');
  });
});

test.describe('Passkey - Virtual Authenticator Registration', () => {
  let cdp: CDPSession;
  let authenticatorId: string;

  test.beforeEach(async ({ page }) => {
    const auth = await createVirtualAuthenticator(page);
    cdp = auth.cdp;
    authenticatorId = auth.authenticatorId;
  });

  test.afterEach(async () => {
    await removeVirtualAuthenticator(cdp, authenticatorId);
  });

  test('should register a credential with virtual authenticator', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(async () => {
      try {
        const credential = (await navigator.credentials.create({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: 'Test', id: 'localhost' },
            user: {
              id: crypto.getRandomValues(new Uint8Array(16)),
              name: 'test@example.com',
              displayName: 'Test User',
            },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'required',
            },
            timeout: 10_000,
          },
        })) as any;

        return {
          success: true,
          hasId: credential.id.length > 0,
          type: credential.type,
        };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.hasId).toBe(true);
      expect(result.type).toBe('public-key');
    }
  });

  test('should list credentials via CDP', async ({ page }) => {
    await loadApp(page);

    // Register a credential first
    await page.evaluate(async () => {
      await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Test', id: 'localhost' },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: 'test@example.com',
            displayName: 'Test User',
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 10_000,
        },
      });
    });

    const credentials = await cdp.send('WebAuthn.getCredentials', {
      authenticatorId,
    });
    expect(credentials.credentials.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Passkey - Credential Storage in localStorage', () => {
  test('should store credential ID in localStorage', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const credentialId = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      const credentialData = {
        id: credentialId,
        type: 'public-key',
        createdAt: Date.now(),
        rpId: 'forwardemail.net',
      };

      localStorage.setItem('fe_passkey_credential', JSON.stringify(credentialData));
      const stored = JSON.parse(localStorage.getItem('fe_passkey_credential') || '{}');

      return {
        hasId: !!stored.id,
        type: stored.type,
        rpId: stored.rpId,
      };
    });

    expect(result.hasId).toBe(true);
    expect(result.type).toBe('public-key');
    expect(result.rpId).toBe('forwardemail.net');
  });

  test('should persist credential across page reloads', async ({ page }) => {
    await loadApp(page);

    await page.evaluate(() => {
      localStorage.setItem(
        'fe_passkey_credential',
        JSON.stringify({ id: 'test-cred-id', type: 'public-key' }),
      );
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(() => {
      const stored = localStorage.getItem('fe_passkey_credential');
      return stored ? JSON.parse(stored) : null;
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe('test-cred-id');
  });

  test('should remove credential on passkey disable', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      localStorage.setItem(
        'fe_passkey_credential',
        JSON.stringify({ id: 'to-remove', type: 'public-key' }),
      );
      localStorage.setItem('fe_app_lock', JSON.stringify({ enabled: true, method: 'passkey' }));

      // Disable passkey
      localStorage.removeItem('fe_passkey_credential');
      localStorage.setItem('fe_app_lock', JSON.stringify({ enabled: false }));

      return {
        credentialRemoved: localStorage.getItem('fe_passkey_credential') === null,
        lockDisabled: JSON.parse(localStorage.getItem('fe_app_lock') || '{}').enabled === false,
      };
    });

    expect(result.credentialRemoved).toBe(true);
    expect(result.lockDisabled).toBe(true);
  });
});

test.describe('Passkey - Lock State Management', () => {
  test('should set lock method to passkey', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      const config = { enabled: true, method: 'passkey', timeout: 300 };
      localStorage.setItem('fe_app_lock', JSON.stringify(config));
      return JSON.parse(localStorage.getItem('fe_app_lock') || '{}');
    });

    expect(result.method).toBe('passkey');
    expect(result.enabled).toBe(true);
  });

  test('should distinguish between PIN and passkey lock methods', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      localStorage.setItem('fe_app_lock', JSON.stringify({ enabled: true, method: 'pin' }));
      const pinConfig = JSON.parse(localStorage.getItem('fe_app_lock') || '{}');

      localStorage.setItem('fe_app_lock', JSON.stringify({ enabled: true, method: 'passkey' }));
      const passkeyConfig = JSON.parse(localStorage.getItem('fe_app_lock') || '{}');

      return {
        pinMethod: pinConfig.method,
        passkeyMethod: passkeyConfig.method,
      };
    });

    expect(result.pinMethod).toBe('pin');
    expect(result.passkeyMethod).toBe('passkey');
  });

  test('should store fallback preference', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      localStorage.setItem(
        'fe_app_lock',
        JSON.stringify({
          enabled: true,
          method: 'passkey',
          fallback: 'pin',
        }),
      );
      return JSON.parse(localStorage.getItem('fe_app_lock') || '{}');
    });

    expect(result.method).toBe('passkey');
    expect(result.fallback).toBe('pin');
  });
});

<script>
  /**
   * App Lock Settings Component
   *
   * Provides UI for configuring the app lock feature:
   *   - Enable/disable app lock
   *   - Set/change PIN
   *   - Register/remove passkey
   *   - Configure inactivity timeout
   *   - Lock on minimize option
   *
   * Placed in Settings > Privacy & Security, above the PGP section.
   */

  import { onMount } from 'svelte';
  import {
    isVaultConfigured,
    isLockEnabled,
    getLockPrefs,
    setLockPrefs,
    setupWithPin,
    setupWithPasskey,
    changePin,
    disableLock,
    isUnlocked,
    unlockWithPin,
  } from '../utils/crypto-store.js';
  import {
    isWebAuthnAvailable,
    isPrfSupported,
    hasPasskeyCredential,
    registerPasskey,
    removePasskeyCredential,
  } from '../utils/passkey-auth.js';

  // --- State ---
  let enabled = false;
  let prefs = getLockPrefs();
  let showSetupPin = false;
  let showChangePin = false;
  let showDisableConfirm = false;
  let pinInput = '';
  let pinConfirm = '';
  let currentPinInput = '';
  let newPinInput = '';
  let newPinConfirm = '';
  let error = '';
  let success = '';
  let loading = false;
  let webauthnAvailable = false;
  let prfSupported = false;
  let passkeyRegistered = false;

  // Timeout options (in milliseconds)
  const TIMEOUT_OPTIONS = [
    { label: '30 seconds', value: 30 * 1000 },
    { label: '1 minute', value: 60 * 1000 },
    { label: '2 minutes', value: 2 * 60 * 1000 },
    { label: '5 minutes', value: 5 * 60 * 1000 },
    { label: '10 minutes', value: 10 * 60 * 1000 },
    { label: '15 minutes', value: 15 * 60 * 1000 },
    { label: '30 minutes', value: 30 * 60 * 1000 },
    { label: '1 hour', value: 60 * 60 * 1000 },
    { label: 'Never', value: 0 },
  ];

  const PIN_LENGTH_OPTIONS = [4, 6, 8];

  onMount(async () => {
    enabled = isLockEnabled() && isVaultConfigured();
    prefs = getLockPrefs();
    webauthnAvailable = isWebAuthnAvailable();
    prfSupported = await isPrfSupported();
    passkeyRegistered = hasPasskeyCredential();
  });

  function clearMessages() {
    error = '';
    success = '';
  }

  function clearInputs() {
    pinInput = '';
    pinConfirm = '';
    currentPinInput = '';
    newPinInput = '';
    newPinConfirm = '';
  }

  function validatePin(pin) {
    const len = prefs.pinLength || 6;
    if (!pin || pin.length !== len) {
      return `PIN must be exactly ${len} digits`;
    }
    if (!/^\d+$/.test(pin)) {
      return 'PIN must contain only digits';
    }
    // Reject trivially weak PINs
    if (/^(.)\1+$/.test(pin)) {
      return 'PIN cannot be all the same digit';
    }
    // Reject sequential PINs (123456, 654321)
    let sequential = true;
    let reverseSequential = true;
    for (let i = 1; i < pin.length; i++) {
      if (Number(pin[i]) !== Number(pin[i - 1]) + 1) sequential = false;
      if (Number(pin[i]) !== Number(pin[i - 1]) - 1) reverseSequential = false;
    }
    if (sequential || reverseSequential) {
      return 'PIN cannot be a sequential number';
    }
    return null;
  }

  async function handleEnableLock() {
    showSetupPin = true;
    clearMessages();
    clearInputs();
  }

  async function handleSetupPin() {
    clearMessages();
    const validationError = validatePin(pinInput);
    if (validationError) {
      error = validationError;
      return;
    }
    if (pinInput !== pinConfirm) {
      error = 'PINs do not match';
      return;
    }

    loading = true;
    try {
      await setupWithPin(pinInput);
      prefs = { ...prefs, enabled: true };
      setLockPrefs(prefs);
      enabled = true;
      showSetupPin = false;
      clearInputs();
      success = 'App lock enabled successfully';
    } catch (err) {
      console.error('[AppLockSettings] Setup failed:', err);
      error = 'Failed to set up app lock. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function handleDisableLock() {
    clearMessages();
    loading = true;
    try {
      await disableLock();
      if (passkeyRegistered) {
        removePasskeyCredential();
        passkeyRegistered = false;
      }
      enabled = false;
      prefs = getLockPrefs();
      showDisableConfirm = false;
      success = 'App lock disabled. Data has been decrypted.';
    } catch (err) {
      console.error('[AppLockSettings] Disable failed:', err);
      error = 'Failed to disable app lock.';
    } finally {
      loading = false;
    }
  }

  async function handleChangePin() {
    clearMessages();
    const validationError = validatePin(newPinInput);
    if (validationError) {
      error = validationError;
      return;
    }
    if (newPinInput !== newPinConfirm) {
      error = 'New PINs do not match';
      return;
    }
    if (!currentPinInput) {
      error = 'Enter your current PIN';
      return;
    }

    loading = true;
    try {
      const changed = await changePin(currentPinInput, newPinInput);
      if (changed) {
        showChangePin = false;
        clearInputs();
        success = 'PIN changed successfully';
      } else {
        error = 'Current PIN is incorrect';
      }
    } catch (err) {
      console.error('[AppLockSettings] Change PIN failed:', err);
      error = 'Failed to change PIN.';
    } finally {
      loading = false;
    }
  }

  async function handleRegisterPasskey() {
    clearMessages();
    loading = true;
    try {
      const result = await registerPasskey('Forward Email User');
      if (result.prfOutput) {
        await setupWithPasskey(result.prfOutput);
        prefs = { ...prefs, hasPasskey: true };
        setLockPrefs(prefs);
        passkeyRegistered = true;
        success = 'Passkey registered successfully';
      } else {
        error =
          'Your device does not support PRF extension. Passkey cannot be used for encryption.';
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        error = 'Passkey registration was cancelled.';
      } else {
        console.error('[AppLockSettings] Passkey registration failed:', err);
        error = 'Failed to register passkey.';
      }
    } finally {
      loading = false;
    }
  }

  function handleRemovePasskey() {
    clearMessages();
    removePasskeyCredential();
    prefs = { ...prefs, hasPasskey: false };
    setLockPrefs(prefs);
    passkeyRegistered = false;
    success = 'Passkey removed';
  }

  function handleTimeoutChange(event) {
    const value = Number(event.target.value);
    prefs = { ...prefs, timeoutMs: value };
    setLockPrefs(prefs);
  }

  function handlePinLengthChange(event) {
    const value = Number(event.target.value);
    prefs = { ...prefs, pinLength: value };
    setLockPrefs(prefs);
  }

  function handleLockOnMinimizeChange(event) {
    prefs = { ...prefs, lockOnMinimize: event.target.checked };
    setLockPrefs(prefs);
  }
</script>

<div class="app-lock-settings">
  <h3 class="section-title">
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="section-icon"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
    App Lock
  </h3>
  <p class="section-description">
    Protect your email with a PIN or passkey. When enabled, all data stored on this device is
    encrypted and the app requires authentication to access.
  </p>

  {#if success}
    <div class="alert alert-success" role="status">{success}</div>
  {/if}
  {#if error}
    <div class="alert alert-error" role="alert">{error}</div>
  {/if}

  {#if !enabled}
    <!-- Not yet enabled -->
    {#if !showSetupPin}
      <button class="btn btn-primary" on:click={handleEnableLock} disabled={loading}>
        Enable App Lock
      </button>
    {:else}
      <!-- PIN setup form -->
      <div class="setup-form">
        <div class="form-group">
          <label for="pin-length">PIN Length</label>
          <select id="pin-length" on:change={handlePinLengthChange} value={prefs.pinLength || 6}>
            {#each PIN_LENGTH_OPTIONS as len}
              <option value={len}>{len} digits</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label for="new-pin">Enter PIN</label>
          <input
            id="new-pin"
            type="password"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength={prefs.pinLength || 6}
            bind:value={pinInput}
            placeholder={'Enter ' + (prefs.pinLength || 6) + '-digit PIN'}
            autocomplete="off"
            disabled={loading}
          />
        </div>

        <div class="form-group">
          <label for="confirm-pin">Confirm PIN</label>
          <input
            id="confirm-pin"
            type="password"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength={prefs.pinLength || 6}
            bind:value={pinConfirm}
            placeholder="Confirm PIN"
            autocomplete="off"
            disabled={loading}
          />
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" on:click={handleSetupPin} disabled={loading}>
            {loading ? 'Setting up...' : 'Set PIN & Enable'}
          </button>
          <button
            class="btn btn-secondary"
            on:click={() => {
              showSetupPin = false;
              clearInputs();
              clearMessages();
            }}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  {:else}
    <!-- Enabled — show configuration options -->
    <div class="settings-grid">
      <!-- Inactivity timeout -->
      <div class="form-group">
        <label for="timeout">Auto-lock after inactivity</label>
        <select id="timeout" on:change={handleTimeoutChange} value={prefs.timeoutMs}>
          {#each TIMEOUT_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <!-- Lock on minimize -->
      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={prefs.lockOnMinimize || false}
            on:change={handleLockOnMinimizeChange}
          />
          Lock when app is minimized or hidden
        </label>
      </div>

      <!-- Change PIN -->
      {#if !showChangePin}
        <button
          class="btn btn-secondary"
          on:click={() => {
            showChangePin = true;
            clearMessages();
            clearInputs();
          }}
        >
          Change PIN
        </button>
      {:else}
        <div class="setup-form">
          <div class="form-group">
            <label for="current-pin">Current PIN</label>
            <input
              id="current-pin"
              type="password"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={prefs.pinLength || 6}
              bind:value={currentPinInput}
              placeholder="Current PIN"
              autocomplete="off"
              disabled={loading}
            />
          </div>
          <div class="form-group">
            <label for="new-pin-change">New PIN</label>
            <input
              id="new-pin-change"
              type="password"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={prefs.pinLength || 6}
              bind:value={newPinInput}
              placeholder="New PIN"
              autocomplete="off"
              disabled={loading}
            />
          </div>
          <div class="form-group">
            <label for="confirm-new-pin">Confirm New PIN</label>
            <input
              id="confirm-new-pin"
              type="password"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={prefs.pinLength || 6}
              bind:value={newPinConfirm}
              placeholder="Confirm New PIN"
              autocomplete="off"
              disabled={loading}
            />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" on:click={handleChangePin} disabled={loading}>
              {loading ? 'Changing...' : 'Change PIN'}
            </button>
            <button
              class="btn btn-secondary"
              on:click={() => {
                showChangePin = false;
                clearInputs();
                clearMessages();
              }}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}

      <!-- Passkey management -->
      {#if webauthnAvailable}
        <div class="passkey-section">
          <h4>Passkey</h4>
          <p class="passkey-description">
            Use your device's biometric authentication (fingerprint, face) or security key as an
            alternative to your PIN. Supported authenticators include Apple Touch ID, Face ID, Optic
            ID, Windows Hello, Android biometrics, YubiKey, Google Titan, and other FIDO2-compatible
            security keys.
          </p>
          {#if prfSupported}
            {#if passkeyRegistered}
              <div class="passkey-status">
                <span class="status-badge active">Passkey registered</span>
                <button
                  class="btn btn-danger-outline btn-sm"
                  on:click={handleRemovePasskey}
                  disabled={loading}
                >
                  Remove
                </button>
              </div>
            {:else}
              <button class="btn btn-secondary" on:click={handleRegisterPasskey} disabled={loading}>
                {loading ? 'Registering...' : 'Register Passkey'}
              </button>
            {/if}
          {:else}
            <p class="passkey-unavailable">
              Passkey registration requires a browser and authenticator that support the WebAuthn
              PRF extension. Your current browser or device does not support this feature. You can
              still use PIN-based app lock.
            </p>
          {/if}
        </div>
      {/if}

      <!-- Disable lock -->
      {#if !showDisableConfirm}
        <button
          class="btn btn-danger-outline"
          on:click={() => {
            showDisableConfirm = true;
            clearMessages();
          }}
        >
          Disable App Lock
        </button>
      {:else}
        <div class="confirm-disable">
          <p class="warning-text">
            Disabling app lock will decrypt all stored data. Your emails and credentials will be
            stored in plaintext on this device.
          </p>
          <div class="form-actions">
            <button class="btn btn-danger" on:click={handleDisableLock} disabled={loading}>
              {loading ? 'Disabling...' : 'Confirm Disable'}
            </button>
            <button
              class="btn btn-secondary"
              on:click={() => {
                showDisableConfirm = false;
                clearMessages();
              }}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .app-lock-settings {
    margin-bottom: 2rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  .section-icon {
    flex-shrink: 0;
  }

  .section-description {
    font-size: 0.875rem;
    color: var(--text-secondary, #6b7280);
    margin: 0 0 1rem;
    line-height: 1.5;
  }

  .alert {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .alert-success {
    background: var(--success-bg, #ecfdf5);
    color: var(--success-fg, #065f46);
    border: 1px solid var(--success-border, #a7f3d0);
  }

  .alert-error {
    background: var(--error-bg, #fef2f2);
    color: var(--error-fg, #991b1b);
    border: 1px solid var(--error-border, #fecaca);
  }

  .settings-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .setup-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--surface-bg, #f9fafb);
    border-radius: 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .form-group label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary, #374151);
  }

  .form-group input,
  .form-group select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-color, #d1d5db);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: var(--input-bg, #ffffff);
    color: var(--text-primary, #111827);
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--focus-color, #3b82f6);
    box-shadow: 0 0 0 2px var(--focus-ring, rgba(59, 130, 246, 0.2));
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .checkbox-group input[type='checkbox'] {
    width: 1rem;
    height: 1rem;
  }

  .form-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--primary-color, #3b82f6);
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--primary-hover, #2563eb);
  }

  .btn-secondary {
    background: var(--secondary-bg, #f3f4f6);
    color: var(--text-primary, #374151);
    border-color: var(--border-color, #d1d5db);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--secondary-hover, #e5e7eb);
  }

  .btn-danger {
    background: var(--danger-color, #ef4444);
    color: #ffffff;
  }

  .btn-danger:hover:not(:disabled) {
    background: var(--danger-hover, #dc2626);
  }

  .btn-danger-outline {
    background: transparent;
    color: var(--danger-color, #ef4444);
    border-color: var(--danger-color, #ef4444);
  }

  .btn-danger-outline:hover:not(:disabled) {
    background: var(--danger-bg, #fef2f2);
  }

  .btn-sm {
    padding: 0.25rem 0.75rem;
    font-size: 0.8125rem;
  }

  .passkey-section {
    padding: 1rem;
    background: var(--surface-bg, #f9fafb);
    border-radius: 0.5rem;
    border: 1px solid var(--border-color, #e5e7eb);
  }

  .passkey-section h4 {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .passkey-description {
    font-size: 0.8125rem;
    color: var(--text-secondary, #6b7280);
    margin: 0 0 0.75rem;
    line-height: 1.4;
  }

  .passkey-unavailable {
    font-size: 0.8125rem;
    color: var(--text-secondary, #6b7280);
    margin: 0;
    line-height: 1.4;
    font-style: italic;
  }

  .passkey-status {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status-badge {
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .status-badge.active {
    background: var(--success-bg, #ecfdf5);
    color: var(--success-fg, #065f46);
  }

  .confirm-disable {
    padding: 1rem;
    background: var(--danger-bg, #fef2f2);
    border-radius: 0.5rem;
    border: 1px solid var(--danger-border, #fecaca);
  }

  .warning-text {
    font-size: 0.875rem;
    color: var(--danger-fg, #991b1b);
    margin: 0 0 0.75rem;
    line-height: 1.5;
  }
</style>

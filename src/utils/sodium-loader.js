/**
 * Thin wrapper around libsodium-wrappers for E2E test consumption.
 *
 * Vite pre-bundles `libsodium-wrappers` into its deps cache, so importing
 * this module via `/src/utils/sodium-loader.js` in page.evaluate() works
 * correctly in the browser context.
 */
import * as sodiumModule from 'libsodium-wrappers';

const sodium = sodiumModule.default || sodiumModule;

export async function getSodium() {
  await sodium.ready;
  return sodium;
}

export default sodium;

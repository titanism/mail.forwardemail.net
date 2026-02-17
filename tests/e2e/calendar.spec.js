import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';
import { setupAuthenticatedSession } from '../fixtures/calendar-helpers.js';

test.describe('Calendar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await setupAuthenticatedSession(page);
  });

  test('should show calendar header with actions', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Event/i })).toBeVisible();
    await expect(page.getByLabel('Import calendar')).toBeVisible();
  });

  test('should display Schedule-X calendar component', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForSelector('.sx-svelte-calendar-wrapper', { timeout: 10000 });
    const calendar = page.locator('.sx-svelte-calendar-wrapper').first();
    await expect(calendar).toBeVisible();
  });

  test('should show existing events on calendar', async ({ page }) => {
    await page.goto('/calendar');
    await page.waitForSelector('.sx-svelte-calendar-wrapper', { timeout: 10000 });

    // Mock events now use today's date, so they should appear in the current view.
    // Schedule-X renders events asynchronously; use polling with a generous timeout.
    const eventLocator = page
      .locator('.sx__event, .sx__month-grid-event, .sx__time-grid-event, [class*="sx__"]')
      .filter({ hasText: /Morning Standup|Client Meeting|Team Building/ });

    await expect(eventLocator.first()).toBeVisible({ timeout: 10000 });
  });
});

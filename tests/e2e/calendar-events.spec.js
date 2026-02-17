import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';
import { setupAuthenticatedSession, waitForSuccessToast } from '../fixtures/calendar-helpers.js';

/**
 * Helper: wait for Schedule-X to render events, then click the named event.
 * Schedule-X renders events as <div class="sx__event"> elements; Playwright's
 * accessibility tree exposes them as role="button".  We use getByText to locate
 * them because the underlying element is a <div>, not a <button>.
 */
async function clickRenderedEvent(page, eventTitle) {
  // Events load asynchronously after the calendar wrapper appears.
  // Wait for the specific event text to appear in the DOM.
  const eventEl = page.getByText(eventTitle, { exact: true }).first();
  await expect(eventEl).toBeVisible({ timeout: 15000 });
  await eventEl.click();
  // Allow the click handler + setTimeout guard to process
  await page.waitForTimeout(500);
}

test.describe('Event Creation', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await setupAuthenticatedSession(page);
    await page.goto('/calendar');
    await page.waitForSelector('.sx-svelte-calendar-wrapper', { timeout: 10000 });
  });

  test('should open new event modal when clicking "+ New Event" button', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'New event' })).toBeVisible();
  });

  test('should create basic timed event', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');
    await modal.getByLabel('Title').fill('Project Kickoff');

    // Verify Save button becomes enabled with valid input
    const saveButton = modal.locator('button:has-text("Save")');
    await expect(saveButton).toBeEnabled();
  });

  test('should create all-day event', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');
    await modal.getByLabel('Title').fill('Holiday');

    // Click the All-day checkbox
    await modal.getByLabel('All-day').check();

    // Verify Save button is enabled
    const saveButton = modal.locator('button:has-text("Save")');
    await expect(saveButton).toBeEnabled();
  });

  test('should create event with optional fields', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');
    await modal.getByLabel('Title').fill('Client Demo');

    // Expand optional fields
    await modal.locator('button:has-text("More details")').click();

    // Verify optional fields are visible and can be filled
    const locationInput = modal.locator('input[placeholder="Add location"]');
    await expect(locationInput).toBeVisible();
    await locationInput.fill('Conference Room A');

    // Verify Save button is enabled
    const saveButton = modal.locator('button:has-text("Save")');
    await expect(saveButton).toBeEnabled();
  });

  test('should validate required title field', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');

    // Title starts empty, Save should be disabled
    const saveButton = modal.locator('button:has-text("Save")');
    await expect(saveButton).toBeDisabled();

    // Fill title to verify button becomes enabled
    await modal.getByLabel('Title').fill('Test Event');
    await expect(saveButton).toBeEnabled();
  });

  test('should close modal on Cancel button', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    await modal.locator('button:has-text("Cancel")').click();

    // Wait for the dialog to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('should close modal on Escape key', async ({ page }) => {
    await page.click('button:has-text("+ New Event")');

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Event Editing', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await setupAuthenticatedSession(page);
    await page.goto('/calendar');
    await page.waitForSelector('.sx-svelte-calendar-wrapper', { timeout: 10000 });
  });

  test('should open edit modal when clicking existing event', async ({ page }) => {
    await clickRenderedEvent(page, 'Morning Standup');

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Edit event' })).toBeVisible();
  });

  test('should update event details', async ({ page }) => {
    await clickRenderedEvent(page, 'Morning Standup');

    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: 'Edit event' })).toBeVisible();

    // The title input doesn't have an accessible label; use the first textbox in the dialog
    const titleInput = modal.getByRole('textbox').first();
    await titleInput.fill('Updated Standup');

    const updateBtn = modal.locator('button:has-text("Update")');
    await expect(updateBtn).toBeEnabled({ timeout: 5000 });
    await updateBtn.click();

    await waitForSuccessToast(page, /updated/i);
  });

  test('should export event as ICS', async ({ page }) => {
    await clickRenderedEvent(page, 'Morning Standup');

    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: 'Edit event' })).toBeVisible();

    // The icon buttons in the edit modal footer are: Duplicate, Export (.ics), Delete.
    // Each is wrapped in a Tooltip.Trigger (button > button > svg).
    // The export button is the second icon-size button (between Duplicate and Delete).
    // We can identify it by hovering to check tooltip, or by index.
    // The footer has: [icon-buttons...] [Cancel] [Update]
    // Icon buttons are variant="outline" size="icon" — they appear before Cancel/Update.
    const downloadPromise = page.waitForEvent('download');
    // Get all buttons in the modal footer area; the icon buttons come before Cancel/Update
    // The second icon button (index 1) is the Export button
    // Use the Download SVG's parent button for export
    const exportButton = modal.locator('svg.lucide-download').first().locator('..');
    await exportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
  });

  test('should delete event with confirmation', async ({ page }) => {
    await clickRenderedEvent(page, 'Morning Standup');

    const editModal = page.getByRole('dialog');
    await expect(editModal.getByRole('heading', { name: 'Edit event' })).toBeVisible();

    // The Delete button is an icon button with destructive styling
    await editModal.locator('button.text-destructive').first().click();

    // Confirm deletion dialog appears
    const confirmDialog = page.getByRole('dialog').filter({ hasText: 'Delete event?' });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.locator('text=permanently removed')).toBeVisible();

    await confirmDialog.locator('button:has-text("Delete")').click();

    await waitForSuccessToast(page, /deleted/i);
  });

  test('should cancel deletion', async ({ page }) => {
    await clickRenderedEvent(page, 'Morning Standup');

    const editModal = page.getByRole('dialog');
    await expect(editModal.getByRole('heading', { name: 'Edit event' })).toBeVisible();

    // Click the Delete icon button
    await editModal.locator('button.text-destructive').first().click();

    // Confirm dialog appears
    const confirmDialog = page.getByRole('dialog').filter({ hasText: 'Delete event?' });
    await expect(confirmDialog).toBeVisible();

    // Cancel the deletion
    await confirmDialog.locator('button:has-text("Cancel")').click();

    // Confirm dialog should close, edit modal should still be visible
    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });
  });
});

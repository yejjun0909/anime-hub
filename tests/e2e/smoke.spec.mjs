import { test, expect } from '@playwright/test';

test('ID 매칭 하네스가 전부 통과한다', async ({ page }) => {
  await page.goto('/tests/id-match.test.html');
  await expect(page.locator('#summary')).toContainText('통과', { timeout: 20_000 });
  await expect(page).toHaveTitle(/^PASS /);
  const result = await page.evaluate(() => window.__KOREAN_MATCH_RESULT__);
  expect(result.failed).toBe(0);
  expect(result.total).toBeGreaterThanOrEqual(30);
});

test('앱 셸이 로드되고 설정 모달이 열린다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.brand-name')).toContainText('ANIME');
  await page.locator('#settings-open').click();
  await expect(page.getByRole('heading', { name: '데이터 · 계정 설정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '전체 백업 다운로드' })).toBeVisible();

  expect(errors).toEqual([]);
});

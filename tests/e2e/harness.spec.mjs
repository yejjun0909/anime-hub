import { test, expect } from '@playwright/test';

// 원본 트리의 브라우저 테스트 하네스를 실행합니다.
test('ID 매칭 하네스가 전부 통과한다', async ({ page }) => {
  await page.goto('/tests/id-match.test.html');
  await expect(page.locator('#summary')).toContainText('통과', { timeout: 20_000 });
  await expect(page).toHaveTitle(/^PASS /);
  const result = await page.evaluate(() => window.__KOREAN_MATCH_RESULT__);
  expect(result.failed).toBe(0);
  expect(result.total).toBeGreaterThanOrEqual(30);
});

test('국내 플랫폼 하네스가 전부 통과한다', async ({ page }) => {
  await page.goto('/tests/korean-platform.test.html');
  await expect(page.locator('#summary')).toContainText('통과', { timeout: 20_000 });
  await expect(page).toHaveTitle(/^PASS /);
  const result = await page.evaluate(() => window.__KOREAN_PLATFORM_RESULT__);
  expect(result.failed).toBe(0);
  expect(result.total).toBeGreaterThanOrEqual(10);
});

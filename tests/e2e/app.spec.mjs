import { test, expect } from '@playwright/test';

// 배포 산출물(_site/)을 기준으로 실행됩니다.
test('배포된 앱 셸이 로드되고 설정 모달이 열린다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.brand-name')).toContainText('애니');
  await page.locator('#settings-open').click();
  await expect(page.getByRole('heading', { name: '데이터 · 계정 설정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '전체 백업 다운로드' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('배포된 앱이 플랫폼 카탈로그와 한국어 데이터를 포함한다', async ({ page }) => {
  const response = await page.request.get('/data/korean-platform-catalog.js');
  expect(response.ok()).toBeTruthy();
  const source = await response.text();
  expect(source).toContain('KOREAN_PLATFORM_CATALOG');
  expect((source.match(/platformId/g) || []).length).toBeGreaterThanOrEqual(100);

  const version = await page.request.get('/VERSION.txt');
  expect(version.ok()).toBeTruthy();
  expect(await version.text()).toContain('v4.13.0');
});

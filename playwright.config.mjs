import { defineConfig, devices } from '@playwright/test';

// Windows에서는 python3/python이 Microsoft Store 스텁인 경우가 있어 py 런처를 사용합니다.
const pythonCommand = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py -3' : 'python3');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8127',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `${pythonCommand} -m http.server 8127 --bind 127.0.0.1`,
    url: 'http://127.0.0.1:8127',
    reuseExistingServer: true,
    timeout: 30_000
  }
});

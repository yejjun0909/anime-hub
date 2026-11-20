import { defineConfig, devices } from '@playwright/test';

// Windows에서는 python3/python이 Microsoft Store 스텁인 경우가 있어 py 런처를 사용합니다.
const pythonCommand = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py -3' : 'python3');
const sitePort = Number(process.env.PW_SITE_PORT || 8127);
const sourcePort = Number(process.env.PW_SOURCE_PORT || 8128);

function serve(port, directory) {
  return {
    command: `${pythonCommand} -m http.server ${port} --bind 127.0.0.1 --directory ${directory}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 30_000
  };
}

// site 프로젝트는 배포 산출물(_site/)을, source 프로젝트는 테스트 하네스가 있는
// 원본 트리를 서빙합니다. 두 프로젝트가 동시에 실행될 수 있도록 포트를 분리했습니다.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  webServer: [serve(sitePort, '_site'), serve(sourcePort, '.')],
  projects: [
    {
      name: 'site',
      testMatch: /app\.spec\.mjs$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${sitePort}`,
        trace: 'retain-on-failure'
      }
    },
    {
      name: 'source',
      testMatch: /harness\.spec\.mjs$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${sourcePort}`,
        trace: 'retain-on-failure'
      }
    }
  ]
});

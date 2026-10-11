import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use the pre-installed Chromium when available (CI containers / sandboxes).
const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const PORT = 3101;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1280, height: 760 },
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile/ },
    { name: 'mobile', testMatch: /mobile/, use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, launchOptions: executablePath ? { executablePath } : {} } },
  ],
  webServer: {
    command: `npm run build && PORT=${PORT} DATA_DIR=./test-results/data node server/dist/index.js`,
    url: `http://localhost:${PORT}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});

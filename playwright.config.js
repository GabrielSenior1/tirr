const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './',
  testMatch: 'tirr.spec.js',
  timeout: 60000,
  expect: {
    timeout: 15000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'results.json' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    headless: true
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'python -m http.server 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 15000,
  },
});

import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AGENT } from './cobalt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// 8199 so a dev service on 8099 can keep running.
const PORT = Number(process.env.TUBE_E2E_PORT) || 8199;
const ROOT = join(HERE, '..', '..');

export default defineConfig({
    testDir: HERE,
    outputDir: join(HERE, 'test-results'),
    // One retry on CI, because YouTube is a live dependency.
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? [['github'], ['list']] : [['list']],
    timeout: 90000,
    expect: { timeout: 20000 },

    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        viewport: { width: 1280, height: 720 },
        trace: 'retain-on-failure',
        video: 'retain-on-failure'
    },

    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], userAgent: AGENT } }],

    webServer: {
        command: 'node service/index.js',
        cwd: ROOT,
        url: `http://127.0.0.1:${PORT}/__tube/state`,
        timeout: 60000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            TUBE_PROXY_PORT: String(PORT),
            TUBE_DEV_UA: AGENT,
            TUBE_PLATFORM_VERSION: '9.0',
            TUBE_BUNDLE_DIR: join(ROOT, 'dist'),
            TUBE_CACHE_DIR: join(ROOT, '.dev', 'e2e-cache')
        }
    }
});

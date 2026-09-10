// The userscript against real YouTube, in a real browser.
//
// The service is the proxy that injects our bundle, so pointing a browser at it is the app minus
// the television. What that last part costs is worth stating: Chromium is not Cobalt, and every
// environment bug this project has hit lived in the gap between them — no History API, key events
// re-dispatched without `repeat`, module chunks arriving after our script. A green run here says
// the feature works, not that it works on a set.
//
// Port 8199 rather than the default: a dev service is usually already holding 8099.

import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TUBE_E2E_PORT) || 8199;
const ROOT = join(HERE, '..', '..');

// What the sets actually send. Asking YouTube as a desktop Chrome returns the desktop site, and
// none of this applies to it.
const TV_USER_AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) 94.0.4606.31/6.5 TV Safari/537.36';

export default defineConfig({
    testDir: HERE,
    // YouTube is a live dependency: a run is allowed one retry before it counts as a failure.
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? [['github'], ['list']] : [['list']],
    timeout: 90000,
    expect: { timeout: 20000 },

    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        userAgent: TV_USER_AGENT,
        viewport: { width: 1280, height: 720 },
        trace: 'retain-on-failure',
        video: 'retain-on-failure'
    },

    projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],

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
            TUBE_DEV_UA: TV_USER_AGENT,
            TUBE_PLATFORM_VERSION: '9.0',
            TUBE_BUNDLE_DIR: join(ROOT, 'dist'),
            TUBE_CACHE_DIR: join(ROOT, '.dev', 'e2e-cache')
        }
    }
});

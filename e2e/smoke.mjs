/**
 * End-to-end smoke test against a running stack (`docker compose up -d --build`).
 * Opens the Campus Overview dashboard in a real browser and checks that both plugins
 * work: name visible, data drawn, table filled, AI summary shown, live stream running,
 * error message for the broken query, and "Save & test" on the data source.
 *
 * Run:  npx playwright@1 install chromium   (once)
 *       node e2e/smoke.mjs [http://localhost:3000]
 */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' – ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1500 } });
try {
  await page.goto(`${base}/d/mis233-campus`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const credit = await page.getByText('Developed by Zeynep Sudem').count();
  check('student name is visible in the panels', credit > 0, `${credit} panels`);

  const series = await page.getByTestId('insight-series').count();
  check('Insight panel draws data from the Campus data source', series >= 4, `${series} series`);

  const rows = await page.getByRole('row').count();
  check('table format fills the summary table', rows >= 5, `${rows} rows`);

  const ai = await page.getByTestId('insight-ai-summary').first().textContent();
  check('Insight AI summary is shown', /Forecast:/.test(ai ?? ''), (ai ?? '').slice(0, 80));

  const err = await page.getByText(/Unknown building "does-not-exist"/).count();
  check('API errors are shown to the user', err > 0);

  const live = page.getByTestId('insight-live');
  await live.first().waitFor({ timeout: 15000 }).catch(() => undefined);
  check('live WebSocket panel is streaming', (await live.count()) > 0);

  await page.goto(`${base}/connections/datasources/edit/campus-sensors`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /save & test/i }).click();
  const ok = await page.getByText(/Connected to Campus Sensor API/).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('data source "Save & test" succeeds', ok);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

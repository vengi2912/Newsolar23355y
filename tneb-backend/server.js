import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import puppeteer from 'puppeteer';
import pLimit from 'p-limit';

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '20kb' }));

const origins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || origins.length === 0 || origins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  },
  methods: ['POST'],
  credentials: true,
}));

// Keep concurrent browser sessions low. Add an external rate limiter/WAF for production.
const limit = pLimit(2);
const cfg = {
  portalUrl: process.env.TNEB_PORTAL_URL,
  user: process.env.TNEB_LOGIN_USER_SELECTOR,
  pass: process.env.TNEB_LOGIN_PASSWORD_SELECTOR,
  submit: process.env.TNEB_LOGIN_SUBMIT_SELECTOR,
  consumer: process.env.TNEB_CONSUMER_SELECTOR,
  billPage: process.env.TNEB_BILL_PAGE_SELECTOR,
  units: process.env.TNEB_LATEST_UNITS_SELECTOR,
  amount: process.env.TNEB_LATEST_AMOUNT_SELECTOR,
  date: process.env.TNEB_BILL_DATE_SELECTOR,
  tariff: process.env.TNEB_TARIFF_SELECTOR,
  meter: process.env.TNEB_METER_SELECTOR,
  row: process.env.TNEB_HISTORY_ROW_SELECTOR,
  period: process.env.TNEB_HISTORY_PERIOD_SELECTOR,
  rowUnits: process.env.TNEB_HISTORY_UNITS_SELECTOR,
  rowAmount: process.env.TNEB_HISTORY_AMOUNT_SELECTOR,
  timeout: Number(process.env.TNEB_LOGIN_TIMEOUT_MS || 20000),
};

function clean(v, max = 160) {
  return String(v ?? '').trim().slice(0, max);
}
function num(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function requiredConfig() {
  const keys = ['portalUrl','user','pass','submit','consumer','units','amount'];
  const missing = keys.filter(k => !cfg[k]);
  if (missing.length) throw new Error(`Backend is not configured: ${missing.join(', ')}`);
}

async function text(page, selector) {
  if (!selector) return null;
  try {
    return await page.$eval(selector, el => el.textContent?.trim() || el.value || '');
  } catch { return null; }
}

async function fetchTneb({ username, password, consumerNumber }) {
  requiredConfig();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setDefaultTimeout(cfg.timeout);
    await page.setViewport({ width: 1365, height: 900 });

    // IMPORTANT: do not log credentials or page content containing credentials.
    await page.goto(cfg.portalUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(cfg.user);
    await page.type(cfg.user, username, { delay: 10 });
    await page.type(cfg.pass, password, { delay: 10 });
    await page.click(cfg.submit);
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: cfg.timeout }).catch(() => {});

    // Do not attempt to bypass CAPTCHA, MFA, OTP or anti-bot controls.
    const captcha = await page.$('iframe[src*="captcha"], [id*="captcha" i], [class*="captcha" i]');
    if (captcha) throw new Error('Portal requires CAPTCHA/anti-bot verification. Complete the official login manually or use an authorized API.');

    await page.waitForSelector(cfg.consumer);
    await page.click(cfg.consumer, { clickCount: 3 });
    await page.type(cfg.consumer, consumerNumber, { delay: 10 });
    if (cfg.billPage) {
      await page.click(cfg.billPage).catch(() => {});
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: cfg.timeout }).catch(() => {});
    }

    const latestUnits = num(await text(page, cfg.units));
    const latestBillAmount = num(await text(page, cfg.amount));
    const billDate = clean(await text(page, cfg.date));
    const tariffCategory = clean(await text(page, cfg.tariff));
    const meterNumber = clean(await text(page, cfg.meter));

    if (latestUnits === null && latestBillAmount === null) {
      throw new Error('Bill values were not found. Update the selectors in .env to match the authorized portal, or use manual entry.');
    }

    const monthlyHistory = [];
    if (cfg.row) {
      const rows = await page.$$(cfg.row);
      for (const row of rows.slice(-12)) {
        const period = await row.$eval(cfg.period, el => el.textContent?.trim() || '').catch(() => '');
        const unitsRaw = await row.$eval(cfg.rowUnits, el => el.textContent?.trim() || '').catch(() => '');
        const amountRaw = await row.$eval(cfg.rowAmount, el => el.textContent?.trim() || '').catch(() => '');
        const units = num(unitsRaw), billAmount = num(amountRaw);
        if (units !== null || billAmount !== null) {
          monthlyHistory.push({ period, units, billAmount, periodMonths: 1 });
        }
      }
    }

    return {
      consumerNumber,
      latestUnits,
      latestBillAmount,
      billDate: billDate || null,
      tariffCategory: tariffCategory || null,
      meterNumber: meterNumber || null,
      monthlyHistory,
      source: 'authorized-backend-proxy',
    };
  } finally {
    await browser.close();
  }
}

app.post('/api/tneb-fetch', async (req, res) => {
  try {
    const username = clean(req.body?.username, 120);
    const password = String(req.body?.password || '').slice(0, 240);
    const consumerNumber = clean(req.body?.consumerNumber, 80);
    if (!username || !password || !consumerNumber) {
      return res.status(400).json({ error: 'Username, password and consumer/service number are required.' });
    }
    const result = await limit(() => fetchTneb({ username, password, consumerNumber }));
    // Never echo username/password back to the browser.
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'Unable to fetch bill data.' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`TNEB backend listening on port ${port}`));

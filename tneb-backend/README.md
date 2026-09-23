# TNEB secure backend template

This is a generic Node.js + Puppeteer template for `/api/tneb-fetch`.

## Important
- Deploy it on HTTPS; GitHub Pages cannot run this Node/Puppeteer backend.
- Replace the example portal URL and CSS selectors in `.env` with selectors from an authorized TNEB/TNPDCL integration/portal.
- Do not log or persist utility usernames/passwords.
- Do not bypass CAPTCHA, MFA, OTP, rate limits, or other access controls. If the portal requires them, use an official API/integration or manual workflow.
- Keep browser concurrency low and add production rate limiting/WAF.

## Run
```bash
npm install
cp .env.example .env
# edit .env
npm start
```

The frontend can use `/api/tneb-fetch` if this backend is reverse-proxied under the same public origin, or a full HTTPS backend URL can be entered in the app Settings.

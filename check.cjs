const chromeLauncher = require('chrome-launcher');
const puppeteer = require('puppeteer-core');

(async () => {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--disable-gpu'] });
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  await page.goto('http://localhost:5174');
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  await chrome.kill();
})();

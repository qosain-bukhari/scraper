const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let browser = null;

  try {
    const { url, selectors, options = {} } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Launch browser
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Navigate to URL
    await page.goto(url, { 
      waitUntil: options.waitUntil || 'networkidle2',
      timeout: options.timeout || 30000
    });

    // Wait for specific element if provided
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10000 });
    }

    // Custom wait time
    if (options.waitTime) {
      await page.waitForTimeout(options.waitTime);
    }

    // Execute custom JavaScript if provided
    if (options.customScript) {
      await page.evaluate(options.customScript);
    }

    // Scrape data based on selectors
    const scrapedData = await page.evaluate((selectors) => {
      const results = {};

      for (const [key, selector] of Object.entries(selectors)) {
        try {
          if (selector.type === 'single') {
            const element = document.querySelector(selector.query);
            results[key] = element ? (
              selector.attribute ? 
              element.getAttribute(selector.attribute) : 
              element.textContent.trim()
            ) : null;
          } 
          else if (selector.type === 'multiple') {
            const elements = document.querySelectorAll(selector.query);
            results[key] = Array.from(elements).map(el => 
              selector.attribute ? 
              el.getAttribute(selector.attribute) : 
              el.textContent.trim()
            );
          }
          else if (selector.type === 'table') {
            const table = document.querySelector(selector.query);
            if (table) {
              const rows = Array.from(table.querySelectorAll('tr'));
              results[key] = rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td, th'));
                return cells.map(cell => cell.textContent.trim());
              });
            }
          }
        } catch (error) {
          results[key] = { error: error.message };
        }
      }

      return results;
    }, selectors);

    // Get page metadata
    const metadata = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      timestamp: new Date().toISOString()
    }));

    await browser.close();

    return res.status(200).json({
      success: true,
      data: scrapedData,
      metadata,
      scrapedAt: new Date().toISOString()
    });

  } catch (error) {
    if (browser) {
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
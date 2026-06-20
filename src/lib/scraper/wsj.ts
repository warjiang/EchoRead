import { chromium, type Browser, type BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";

const STORAGE_PATH =
  process.env.WSJ_STORAGE_PATH ||
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", ".wsj-auth.json");

async function createBrowser(): Promise<Browser> {
  const cdpEndpoint = process.env.PLAYWRIGHT_CDP_URL;
  if (cdpEndpoint) {
    return chromium.connectOverCDP(cdpEndpoint);
  }

  const remoteEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
  if (remoteEndpoint) {
    return chromium.connect(remoteEndpoint);
  }
  return chromium.launch({ headless: true });
}

async function getAuthenticatedContext(browser: Browser): Promise<BrowserContext> {
  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });

  if (fs.existsSync(STORAGE_PATH)) {
    const context = await browser.newContext({
      storageState: STORAGE_PATH,
    });
    return context;
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://sso.accounts.dowjones.com/login");
  await page.waitForLoadState("networkidle");

  await page.fill('input[name="username"], input[type="email"]', process.env.WSJ_EMAIL || "");
  await page.click('button[type="submit"], button:has-text("Continue")');
  await page.waitForTimeout(2000);

  await page.fill('input[name="password"], input[type="password"]', process.env.WSJ_PASSWORD || "");
  await page.click('button[type="submit"], button:has-text("Sign In")');
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });

  await context.storageState({ path: STORAGE_PATH });
  await page.close();

  return context;
}

export interface ScrapedArticle {
  title: string;
  url: string;
  content: string;
  category?: string;
  publishedAt: Date;
}

export async function scrapeWSJArticles(maxArticles = 5): Promise<ScrapedArticle[]> {
  const browser = await createBrowser();

  try {
    const context = await getAuthenticatedContext(browser);
    const page = await context.newPage();

    await page.goto("https://www.wsj.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Get article links from the homepage
    const articleLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/articles/"]'));
      const uniqueLinks = new Map<string, string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const text = link.textContent?.trim() || "";
        if (href && text && text.length > 20 && !uniqueLinks.has(href)) {
          uniqueLinks.set(href, text);
        }
      }
      return Array.from(uniqueLinks.entries()).map(([url, title]) => ({ url, title }));
    });

    const articles: ScrapedArticle[] = [];

    for (const link of articleLinks.slice(0, maxArticles)) {
      try {
        await page.goto(link.url, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);

        const content = await page.evaluate(() => {
          const paragraphs = document.querySelectorAll("article p, .article-content p, [class*='article'] p");
          return Array.from(paragraphs)
            .map((p) => p.textContent?.trim())
            .filter((t) => t && t.length > 0)
            .join("\n\n");
        });

        const category = await page.evaluate(() => {
          const breadcrumb = document.querySelector('[class*="breadcrumb"] a, nav a[href*="/news/"]');
          return breadcrumb?.textContent?.trim() || null;
        });

        if (content && content.length > 100) {
          articles.push({
            title: link.title,
            url: link.url,
            content,
            category: category || undefined,
            publishedAt: new Date(),
          });
        }
      } catch (e) {
        console.error(`Failed to scrape ${link.url}:`, e);
      }
    }

    await context.close();
    return articles;
  } finally {
    await browser.close();
  }
}

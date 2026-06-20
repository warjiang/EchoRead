import { chromium, type Browser } from "playwright";
import { loadEnvConfig } from "@next/env";
import * as fs from "fs";
import * as path from "path";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

loadEnvConfig(process.cwd());

const STORAGE_PATH =
  process.env.WSJ_STORAGE_PATH ||
  path.join(process.cwd(), "data", ".wsj-auth.json");

type BrowserMode = "cdp" | "ws" | "local";

interface BrowserSession {
  browser: Browser;
  mode: BrowserMode;
}

async function createBrowserSession(): Promise<BrowserSession> {
  const cdpEndpoint = process.env.PLAYWRIGHT_CDP_URL;
  if (cdpEndpoint) {
    console.log(`Connecting over CDP: ${cdpEndpoint}`);
    return {
      browser: await chromium.connectOverCDP(cdpEndpoint),
      mode: "cdp",
    };
  }

  const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
  if (wsEndpoint) {
    console.log(`Connecting over Playwright WS: ${wsEndpoint}`);
    return {
      browser: await chromium.connect(wsEndpoint),
      mode: "ws",
    };
  }

  console.log("No remote endpoint configured, launching local Chromium.");
  return {
    browser: await chromium.launch({ headless: false }),
    mode: "local",
  };
}

async function main() {
  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });

  const { browser, mode } = await createBrowserSession();
  let context = browser.contexts()[0];
  let createdContext = false;

  if (!context) {
    context = await browser.newContext();
    createdContext = true;
  }

  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  await page.goto("https://sso.accounts.dowjones.com/login", {
    waitUntil: "domcontentloaded",
  });

  console.log("");
  console.log("Complete WSJ login (including any verification) in the browser.");
  console.log("After login succeeds, press Enter here to save storage state.");
  console.log(`Storage path: ${STORAGE_PATH}`);

  const rl = createInterface({ input, output });
  await rl.question("");
  rl.close();

  await context.storageState({ path: STORAGE_PATH });

  if (createdContext) {
    await context.close();
  }

  if (mode === "local") {
    await browser.close();
  } else {
    console.log("Remote browser kept alive for reuse.");
  }

  console.log("WSJ login state saved.");
}

main().catch((error) => {
  console.error("Failed to save WSJ login state:", error);
  process.exit(1);
});

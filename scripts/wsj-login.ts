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

async function createBrowser(): Promise<Browser> {
  const cdpEndpoint = process.env.PLAYWRIGHT_CDP_URL;
  if (cdpEndpoint) {
    console.log(`Connecting over CDP: ${cdpEndpoint}`);
    return chromium.connectOverCDP(cdpEndpoint);
  }

  const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
  if (wsEndpoint) {
    console.log(`Connecting over Playwright WS: ${wsEndpoint}`);
    return chromium.connect(wsEndpoint);
  }

  console.log("No remote endpoint configured, launching local Chromium.");
  return chromium.launch({ headless: false });
}

async function main() {
  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });

  const browser = await createBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

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
  await context.close();
  await browser.close();

  console.log("WSJ login state saved.");
}

main().catch((error) => {
  console.error("Failed to save WSJ login state:", error);
  process.exit(1);
});

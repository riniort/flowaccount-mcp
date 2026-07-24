import { chromium, type BrowserContext, type Page } from "playwright";
import { logger } from "../utils/logger.js";
import type { Config } from "../utils/config.js";
import type { StoredCookie, TokenData } from "./token-store.js";
import { readWindowsCredential } from "./windows-credential.js";
import { readFileSync } from "node:fs";

// Shared cookie domains we need to capture
const COOKIE_URLS = [
  "https://advance.flowaccount.com",
  "https://api-core-canary.flowaccount.com",
  "https://business-api.flowaccount.com",
  "https://auth.flowaccount.com",
  "https://profile.flowaccount.com",
];

/**
 * Try to silently refresh the access token by reusing stored session cookies.
 * auth.flowaccount.com session cookies typically live much longer than the
 * access token (days vs ~1 hour), so we can get a new token without user login.
 *
 * Returns new TokenData on success, or null if interactive login is needed.
 */
export async function silentRefresh(
  config: Config,
  existingTokenData: TokenData
): Promise<TokenData | null> {
  logger.info("Attempting silent token refresh using stored cookies...");

  let browser;
  try {
    // Silent refresh always runs headless — no user interaction needed
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Inject the stored cookies into the browser context
    const playwrightCookies = existingTokenData.cookies
      .filter((c) => c.name && c.value && c.domain)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        expires: c.expires > 0 ? c.expires : -1,
        httpOnly: false,
        secure: true,
        sameSite: "None" as const,
      }));

    if (playwrightCookies.length === 0) {
      logger.info("No stored cookies available for silent refresh");
      await browser.close();
      return null;
    }

    await context.addCookies(playwrightCookies);

    const page = await context.newPage();
    let capturedAccessToken = "";

    // Intercept to capture fresh Bearer token
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.includes("flowaccount.com") && !url.includes("auth.flowaccount.com")) {
        const headers = await request.allHeaders();
        const auth = headers["authorization"] || headers["Authorization"] || "";
        if (auth.startsWith("Bearer ") && auth.length > 20) {
          capturedAccessToken = auth.replace("Bearer ", "");
        }
      }
      await route.continue();
    });

    // Navigate — if session cookies are valid, it auto-redirects to dashboard
    await page.goto("https://advance.flowaccount.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for dashboard URL (company selected) — short timeout since this should be fast
    try {
      await page.waitForURL(/advance\.flowaccount\.com\/N\d+\/business\//, {
        timeout: 15000,
      });
    } catch {
      // If we ended up at login page, silent refresh failed
      logger.info("Silent refresh failed — session expired, need interactive login");
      await browser.close();
      return null;
    }

    // Wait for API calls to fire and capture token
    await page.waitForTimeout(3000);

    // Try localStorage fallback
    if (!capturedAccessToken) {
      capturedAccessToken = await extractTokenFromLocalStorage(page);
    }

    if (!capturedAccessToken) {
      logger.info("Silent refresh: navigated OK but failed to capture token");
      await browser.close();
      return null;
    }

    // Capture fresh cookies
    const tokenData = await buildTokenData(context, page, capturedAccessToken, config);
    await browser.close();

    logger.info("Silent token refresh successful!");
    return tokenData;
  } catch (err) {
    logger.debug("Silent refresh error:", err);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

/**
 * Authenticate with a browser. When a Windows credential is available, the
 * entire login and company-selection flow runs headless in the background.
 * When a Windows credential target is configured but missing, return
 * actionable setup guidance to the MCP client instead of blocking on a hidden
 * desktop prompt. Set FLOWACCOUNT_CREDENTIAL_TARGET="" to use the visible
 * interactive-browser fallback.
 */
export async function authenticateWithBrowser(config: Config): Promise<TokenData> {
  const credential = await readWindowsCredential(config.credentialTarget);
  if (
    !credential &&
    process.platform === "win32" &&
    config.credentialTarget
  ) {
    throw new Error(
      `FlowAccount credential was not found in Windows Credential Manager. ` +
      `Add a Generic Credential with Internet or network address ` +
      `"${config.credentialTarget}", your FlowAccount login email as the user name, ` +
      `and your FlowAccount password. Then retry get_active_company. ` +
      `Do not send the password in chat.`
    );
  }
  const backgroundLogin = Boolean(credential);

  if (backgroundLogin) {
    logger.info("FlowAccount MCP: authenticating in background...");
  } else {
    logger.info("==============================================");
    logger.info("FlowAccount MCP: กำลังเปิดบราวเซอร์สำหรับ Login");
    logger.info("กรุณา Login เข้า FlowAccount แล้วเลือกบริษัทในบราวเซอร์");
    logger.info("==============================================");
  }

  const browser = await chromium.launch({
    headless: config.headless || backgroundLogin,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

  let capturedAccessToken = "";

  // Intercept requests to capture Bearer token if present
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("flowaccount.com") && !url.includes("auth.flowaccount.com")) {
      const headers = await request.allHeaders();
      const auth = headers["authorization"] || headers["Authorization"] || "";
      if (auth.startsWith("Bearer ") && auth.length > 20) {
        capturedAccessToken = auth.replace("Bearer ", "");
      }
    }
    await route.continue();
  });

  // Navigate to app — will redirect to login page
    const authenticationTimeout = backgroundLogin
      ? Math.min(config.browserTimeout, 45000)
      : config.browserTimeout;
    await page.goto("https://advance.flowaccount.com/", {
      waitUntil: "domcontentloaded",
      timeout: authenticationTimeout,
    });

    // advance.flowaccount.com performs a client-side redirect to the identity
    // server. page.goto() can return before that redirect has settled, which
    // previously made a valid stored credential get skipped entirely.
    await page.waitForURL(
      /auth\.flowaccount\.com\/Account\/(Login|SelectCompany)|advance\.flowaccount\.com\/N\d+\/business\//,
      { timeout: Math.min(authenticationTimeout, 15000) }
    ).catch(() => {});

  if (credential && /auth\.flowaccount\.com/i.test(page.url())) {
    logger.debug("Using Windows Credential Manager for automatic login");
    await submitStoredCredential(page, credential.username, credential.password);
    await selectCompanyIfNeeded(page, config);
  } else if (config.credentialTarget) {
    logger.debug("Stored credential not needed or unavailable");
  }

  // Wait until user has logged in AND selected a company
  logger.debug("Waiting for login and company selection...");
    try {
      await page.waitForURL(/advance\.flowaccount\.com\/N\d+\/business\//, {
        timeout: authenticationTimeout,
      });
    } catch (error) {
      if (backgroundLogin) {
        throw new Error(
          `Background FlowAccount login did not reach a company dashboard within ${authenticationTimeout / 1000} seconds. ` +
          `Update the Generic Credential "${config.credentialTarget}" in Windows Credential Manager, then try again.`,
          { cause: error }
        );
      }
      throw error;
    }
  logger.debug("Login succeeded; capturing session cookies...");

  // Wait a moment for initial API calls to fire
  await page.waitForTimeout(3000);

  // Try localStorage fallback
  if (!capturedAccessToken) {
    capturedAccessToken = await extractTokenFromLocalStorage(page);
  }

    if (!capturedAccessToken) {
      throw new Error("FlowAccount login reached the dashboard but no access token was captured");
    }
    const tokenData = await buildTokenData(context, page, capturedAccessToken, config);
    if (!tokenData.extraHeaders?.["X-Company-Id"]) {
      throw new Error("FlowAccount login succeeded but the active company code was not detected");
    }
    logger.info("FlowAccount authentication ready");

    return tokenData;
  } finally {
    await browser.close().catch(() => {});
  }
}

// --- Shared helpers ---

async function submitStoredCredential(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  const usernameInput = page
    .locator(
      'input[type="email"], input[autocomplete="username"], input[name*="email" i], input[name*="user" i]'
    )
    .first();
  await usernameInput.waitFor({ state: "visible", timeout: 15000 });
  await usernameInput.fill(username);

  let passwordInput = page
    .locator('input[type="password"], input[autocomplete="current-password"]')
    .first();
  if (!(await passwordInput.isVisible().catch(() => false))) {
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    passwordInput = page
      .locator('input[type="password"], input[autocomplete="current-password"]')
      .first();
    await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  }

  await passwordInput.fill(password);
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
  logger.debug("Submitted stored FlowAccount credential");
}

async function selectCompanyIfNeeded(page: Page, config: Config): Promise<void> {
  await page
    .waitForURL(
      /auth\.flowaccount\.com\/Account\/SelectCompany|advance\.flowaccount\.com\/N\d+\/business\//,
      { timeout: 30000 }
    )
    .catch(() => {});

  if (!/\/Account\/SelectCompany/i.test(page.url())) return;

  const supportCode =
    config.companySupportCode || readStoredCompanySupportCode(config.tokenStorePath);
  if (!/^N\d+$/.test(supportCode)) {
    logger.info("กรุณาเลือกบริษัทในบราวเซอร์ (ยังไม่ได้กำหนด Company Support Code)");
    return;
  }

  const companyLink = page
    .locator('a[href*="/Account/SelectCompany"]')
    .filter({ hasText: supportCode })
    .first();
  await companyLink.waitFor({ state: "visible", timeout: 15000 });
  await Promise.all([
    page.waitForURL(/advance\.flowaccount\.com\/N\d+\/business\//, {
      timeout: Math.min(config.browserTimeout, 45000),
    }),
    companyLink.click(),
  ]);
  logger.debug(`Selected company ${supportCode}`);
}

function readStoredCompanySupportCode(tokenStorePath: string): string {
  try {
    const stored = JSON.parse(readFileSync(tokenStorePath, "utf8")) as {
      extraHeaders?: Record<string, string>;
    };
    return stored.extraHeaders?.["X-Company-Id"] || "";
  } catch {
    return "";
  }
}

async function extractTokenFromLocalStorage(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        const v = localStorage.getItem(k) || "";
        if (v.startsWith("ey") && v.length > 100) return v;
        try {
          const obj = JSON.parse(v);
          if (obj?.access_token?.startsWith("ey")) return obj.access_token;
        } catch {}
      }
      return "";
    });
  } catch {
    logger.debug("ไม่พบ token ใน localStorage");
    return "";
  }
}

async function buildTokenData(
  context: BrowserContext,
  page: Page,
  accessToken: string,
  config: Config
): Promise<TokenData> {
  // Capture ALL cookies from ALL flowaccount.com subdomains
  const allCookies = await context.cookies(COOKIE_URLS);

  const cookies: StoredCookie[] = allCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
  }));

  logger.debug(`Captured ${cookies.length} cookies`);

  // Extract company ID from URL
  const currentUrl = page.url();
  const companyMatch = currentUrl.match(/\/(N\d+)\//);
  const companyId = companyMatch?.[1] || "";
  logger.debug(`Company ID: ${companyId}`);

  return {
    accessToken,
    cookies,
    apiBaseUrl: "https://api-core-canary.flowaccount.com",
    culture: config.culture,
    extraHeaders: { "X-Company-Id": companyId },
    expiresAt: parseJwtExpiry(accessToken),
    discoveredAt: Date.now(),
  };
}

function parseJwtExpiry(token: string): number {
  const fallback = Date.now() + 60 * 60 * 1000; // 1 hour fallback
  if (!token) return fallback;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return fallback;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.exp === "number") {
      return payload.exp * 1000; // convert seconds to ms
    }
    return fallback;
  } catch {
    logger.warn("ไม่สามารถอ่าน JWT expiry ได้ ใช้ค่า fallback 1 ชั่วโมง");
    return fallback;
  }
}

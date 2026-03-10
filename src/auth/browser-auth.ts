import { chromium } from "playwright";
import { logger } from "../utils/logger.js";
import type { Config } from "../utils/config.js";
import type { StoredCookie, TokenData } from "./token-store.js";

export async function authenticateWithBrowser(config: Config): Promise<TokenData> {
  logger.info("==============================================");
  logger.info("FlowAccount MCP: กำลังเปิดบราวเซอร์สำหรับ Login");
  logger.info("กรุณา Login เข้า FlowAccount แล้วเลือกบริษัทในบราวเซอร์");
  logger.info("==============================================");

  const browser = await chromium.launch({ headless: config.headless });
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
  await page.goto("https://advance.flowaccount.com/", {
    waitUntil: "domcontentloaded",
    timeout: config.browserTimeout,
  });

  // Wait until user has logged in AND selected a company (URL becomes /NXXXXXX/business/...)
  logger.info("รอการ Login และเลือกบริษัท...");
  await page.waitForURL(/advance\.flowaccount\.com\/N\d+\/business\//, {
    timeout: config.browserTimeout,
  });
  logger.info("Login สำเร็จ! กำลังจับ session cookies...");

  // Wait a moment for initial API calls to fire
  await page.waitForTimeout(3000);

  // Capture ALL cookies from ALL flowaccount.com subdomains via Playwright CDP
  // (This includes HttpOnly cookies that JavaScript cannot read)
  const allCookies = await context.cookies([
    "https://advance.flowaccount.com",
    "https://api-core-canary.flowaccount.com",
    "https://business-api.flowaccount.com",
    "https://auth.flowaccount.com",
    "https://profile.flowaccount.com",
  ]);

  const cookies: StoredCookie[] = allCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
  }));

  logger.info(`จับ cookies ได้ ${cookies.length} รายการ`);

  // Try to get token from localStorage as fallback
  if (!capturedAccessToken) {
    try {
      capturedAccessToken = await page.evaluate(() => {
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
    }
  }

  // Extract company ID from URL for reference
  const currentUrl = page.url();
  const companyMatch = currentUrl.match(/\/(N\d+)\//);
  const companyId = companyMatch?.[1] || "";
  logger.info(`Company ID: ${companyId}`);

  await browser.close();
  logger.info("ปิดบราวเซอร์แล้ว - MCP Server พร้อมใช้งาน");

  return {
    accessToken: capturedAccessToken,
    cookies,
    apiBaseUrl: "https://api-core-canary.flowaccount.com",
    culture: config.culture,
    extraHeaders: { "X-Company-Id": companyId },
    expiresAt: parseJwtExpiry(capturedAccessToken),
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

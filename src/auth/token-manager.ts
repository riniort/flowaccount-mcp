import { logger } from "../utils/logger.js";
import type { Config } from "../utils/config.js";
import { TokenStore, type TokenData } from "./token-store.js";
import { authenticateWithBrowser } from "./browser-auth.js";

export class TokenManager {
  private tokenStore: TokenStore;
  private tokenData: TokenData | null = null;

  constructor(private config: Config) {
    this.tokenStore = new TokenStore(config.tokenStorePath);
  }

  async initialize(): Promise<void> {
    // Try to load existing tokens
    this.tokenData = this.tokenStore.load();

    if (this.tokenData && this.isValid()) {
      logger.info("Using stored tokens (valid)");
      return;
    }

    if (this.tokenData) {
      logger.info("Stored tokens expired, re-authenticating...");
    }

    // Need fresh authentication
    await this.authenticate();
  }

  private isValid(): boolean {
    if (!this.tokenData) return false;
    // Check if token is expired (with 5 min buffer)
    return this.tokenData.expiresAt > Date.now() + 5 * 60 * 1000;
  }

  async authenticate(): Promise<void> {
    this.tokenData = await authenticateWithBrowser(this.config);
    this.tokenStore.save(this.tokenData);
  }

  async getAuthHeaders(targetBaseUrl?: string): Promise<Record<string, string>> {
    if (!this.tokenData || !this.isValid()) {
      logger.info("Token expired, re-authenticating...");
      await this.authenticate();
    }

    const headers: Record<string, string> = {};

    // Use Bearer token if captured, otherwise fall back to cookies only
    if (this.tokenData!.accessToken) {
      headers["Authorization"] = `Bearer ${this.tokenData!.accessToken}`;
    }

    // Include extra headers (e.g. X-Company-Id) captured during login
    if (this.tokenData!.extraHeaders) {
      Object.assign(headers, this.tokenData!.extraHeaders);
    }

    // Send only cookies that match the target host
    if (this.tokenData!.cookies.length > 0) {
      let targetHost = "";
      if (targetBaseUrl) {
        try {
          targetHost = new URL(targetBaseUrl).hostname;
        } catch {}
      }

      const cookieStr = this.tokenData!.cookies
        .filter((c) => {
          if (!targetHost) return c.domain.includes("flowaccount.com");
          // Match cookie domain to target host (cookie domain ".x.com" matches "x.com" and "sub.x.com")
          const cookieDomain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
          return targetHost === cookieDomain || targetHost.endsWith(`.${cookieDomain}`);
        })
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      if (cookieStr) headers["Cookie"] = cookieStr;
    }

    return headers;
  }

  getCulture(): string {
    return this.tokenData?.culture || this.config.culture;
  }

  async refreshOrReauthenticate(): Promise<void> {
    logger.info("Token refresh triggered, re-authenticating via browser...");
    await this.authenticate();
  }
}

import { logger } from "../utils/logger.js";
import type { Config } from "../utils/config.js";
import { TokenStore, type TokenData } from "./token-store.js";
import { authenticateWithBrowser, silentRefresh } from "./browser-auth.js";

export class TokenManager {
  private tokenStore: TokenStore;
  private tokenData: TokenData | null = null;
  private refreshPromise: Promise<void> | null = null;

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

    if (this.tokenData && this.tokenData.cookies.length > 0) {
      // Token expired but we have session cookies — try silent refresh first
      logger.info("Access token expired, trying silent refresh...");
      const refreshed = await silentRefresh(this.config, this.tokenData);
      if (refreshed) {
        this.tokenData = refreshed;
        this.tokenStore.save(refreshed);
        return;
      }
      logger.info("Silent refresh failed, need interactive login");
    }

    // Need fresh interactive authentication
    await this.interactiveLogin();
  }

  private isValid(): boolean {
    if (!this.tokenData) return false;
    // Check if token is expired (with 2 min buffer)
    return this.tokenData.expiresAt > Date.now() + 2 * 60 * 1000;
  }

  private async interactiveLogin(): Promise<void> {
    this.tokenData = await authenticateWithBrowser(this.config);
    this.tokenStore.save(this.tokenData);
  }

  /**
   * Try silent refresh first, fall back to interactive login.
   * Deduplicates concurrent calls so only one refresh runs at a time.
   */
  async refreshOrReauthenticate(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        // Try silent refresh if we have cookies
        if (this.tokenData && this.tokenData.cookies.length > 0) {
          logger.info("Token refresh: trying silent refresh...");
          const refreshed = await silentRefresh(this.config, this.tokenData);
          if (refreshed) {
            this.tokenData = refreshed;
            this.tokenStore.save(refreshed);
            return;
          }
        }

        // Fall back to interactive login
        logger.info("Token refresh: falling back to interactive login...");
        await this.interactiveLogin();
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async getAuthHeaders(targetBaseUrl?: string): Promise<Record<string, string>> {
    if (!this.tokenData || !this.isValid()) {
      await this.refreshOrReauthenticate();
    }

    if (!this.tokenData) {
      throw new Error("Authentication failed: no token data available");
    }

    const headers: Record<string, string> = {};

    // Use Bearer token if captured, otherwise fall back to cookies only
    if (this.tokenData.accessToken) {
      headers["Authorization"] = `Bearer ${this.tokenData.accessToken}`;
    }

    // Include extra headers (e.g. X-Company-Id) captured during login
    if (this.tokenData.extraHeaders) {
      Object.assign(headers, this.tokenData.extraHeaders);
    }

    // Send only cookies that match the target host
    if (this.tokenData.cookies.length > 0) {
      let targetHost = "";
      if (targetBaseUrl) {
        try {
          targetHost = new URL(targetBaseUrl).hostname;
        } catch {}
      }

      const cookieStr = this.tokenData.cookies
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
}

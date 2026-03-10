import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { dirname } from "path";
import { logger } from "../utils/logger.js";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
}

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  cookies: StoredCookie[];
  apiBaseUrl: string;
  culture: string;
  extraHeaders?: Record<string, string>;
  discoveredAt: number;
}

export class TokenStore {
  constructor(private filePath: string) {}

  save(data: TokenData): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    // Ensure permissions even if file already existed
    chmodSync(this.filePath, 0o600);
    logger.info("Tokens saved to", this.filePath);
  }

  load(): TokenData | null {
    if (!existsSync(this.filePath)) {
      logger.info("No stored tokens found");
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as TokenData;
      logger.info("Tokens loaded from disk");
      return data;
    } catch (err) {
      logger.error("Failed to load tokens:", err);
      return null;
    }
  }

  clear(): void {
    if (existsSync(this.filePath)) {
      writeFileSync(this.filePath, "{}", "utf-8");
      logger.info("Tokens cleared");
    }
  }
}

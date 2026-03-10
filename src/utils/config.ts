import { homedir } from "os";
import { join } from "path";

export interface Config {
  culture: string;
  tokenStorePath: string;
  headless: boolean;
  browserTimeout: number;
  apiBaseUrl?: string;
}

const VALID_CULTURE = /^[a-z]{2}(-[A-Z]{2})?$/; // e.g. "th", "en-US"

export function loadConfig(): Config {
  const culture = process.env.FLOWACCOUNT_CULTURE || "th";
  if (!VALID_CULTURE.test(culture)) {
    throw new Error(`Invalid FLOWACCOUNT_CULTURE "${culture}". Expected format: "th", "en", "en-US"`);
  }
  return {
    culture,
    tokenStorePath:
      process.env.FLOWACCOUNT_TOKEN_PATH ||
      join(homedir(), ".flowaccount-mcp", "tokens.json"),
    headless: process.env.FLOWACCOUNT_HEADLESS === "true",
    browserTimeout: parseInt(process.env.FLOWACCOUNT_BROWSER_TIMEOUT || "120000", 10),
    apiBaseUrl: process.env.FLOWACCOUNT_API_BASE_URL,
  };
}

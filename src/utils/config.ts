import { homedir } from "os";
import { isAbsolute, join } from "path";
import { getDefaultChartCachePath } from "../chart-accounts/app-data.js";

export interface Config {
  culture: string;
  tokenStorePath: string;
  headless: boolean;
  browserTimeout: number;
  apiBaseUrl?: string;
  credentialTarget: string;
  companySupportCode: string;
  idleRecheckMs: number;
  chartCachePath: string;
  chartCacheTtlMs: number;
}

const VALID_CULTURE = /^[a-z]{2}(-[A-Z]{2})?$/; // e.g. "th", "en-US"

export function loadConfig(): Config {
  const culture = process.env.FLOWACCOUNT_CULTURE || "th";
  if (!VALID_CULTURE.test(culture)) {
    throw new Error(`Invalid FLOWACCOUNT_CULTURE "${culture}". Expected format: "th", "en", "en-US"`);
  }
  const chartCachePath =
    process.env.FLOWACCOUNT_CHART_CACHE_PATH || getDefaultChartCachePath();
  if (!isAbsolute(chartCachePath)) {
    throw new Error("FLOWACCOUNT_CHART_CACHE_PATH must be absolute and outside the repository");
  }
  const chartCacheTtlMs = parseInt(
    process.env.FLOWACCOUNT_CHART_CACHE_TTL_MS || String(24 * 60 * 60 * 1000),
    10
  );
  if (!Number.isFinite(chartCacheTtlMs) || chartCacheTtlMs <= 0) {
    throw new Error("FLOWACCOUNT_CHART_CACHE_TTL_MS must be a positive integer");
  }
  return {
    culture,
    tokenStorePath:
      process.env.FLOWACCOUNT_TOKEN_PATH ||
      join(homedir(), ".flowaccount-mcp", "tokens.json"),
    headless: process.env.FLOWACCOUNT_HEADLESS === "true",
    browserTimeout: parseInt(process.env.FLOWACCOUNT_BROWSER_TIMEOUT || "120000", 10),
    apiBaseUrl: process.env.FLOWACCOUNT_API_BASE_URL,
    credentialTarget:
      process.env.FLOWACCOUNT_CREDENTIAL_TARGET ??
      (process.platform === "win32" ? "FlowAccountMCP" : ""),
    companySupportCode: process.env.FLOWACCOUNT_COMPANY_SUPPORT_CODE || "",
    idleRecheckMs: parseInt(
      process.env.FLOWACCOUNT_IDLE_RECHECK_MS || String(15 * 60 * 1000),
      10
    ),
    chartCachePath,
    chartCacheTtlMs,
  };
}

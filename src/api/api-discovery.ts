import { logger } from "../utils/logger.js";

// API discovery is primarily handled during browser-auth.ts login flow.
// This module provides utilities to analyze captured API calls.

export interface DiscoveredEndpoint {
  method: string;
  path: string;
  fullUrl: string;
}

export function analyzeApiCalls(urls: string[]): {
  baseUrl: string;
  paths: string[];
} {
  if (urls.length === 0) {
    return { baseUrl: "https://app.flowaccount.com", paths: [] };
  }

  // Find common base URL
  const parsed = urls.map((u) => new URL(u));
  const baseUrl = parsed[0].origin;

  // Extract unique paths
  const paths = [...new Set(parsed.map((u) => u.pathname))].sort();

  logger.info(`Discovered ${paths.length} unique API paths from ${urls.length} calls`);
  logger.debug("API paths:", paths);

  return { baseUrl, paths };
}

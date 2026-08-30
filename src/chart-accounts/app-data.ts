import { chmodSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export function getDefaultChartCachePath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "FlowAccountMCP", "data", "cache.sqlite");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "FlowAccountMCP", "cache.sqlite");
  }
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "flowaccount-mcp", "cache.sqlite");
}

export function ensurePrivateCacheLocation(filePath: string): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
    if (existsSync(filePath)) chmodSync(filePath, 0o600);
  } catch {
    // Windows ACLs are controlled by the user's profile directory. POSIX modes
    // are applied where the platform supports them.
  }
}

export function secureCacheFile(filePath: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort on platforms without POSIX permission semantics.
  }
}

import { DatabaseSync } from "node:sqlite";
import { ensurePrivateCacheLocation, secureCacheFile } from "./app-data.js";
import type { ChartAccount, ChartCacheState, CompanyCacheRecord } from "./types.js";

const SCHEMA_VERSION = 1;

export class ChartAccountRepository {
  private readonly db: DatabaseSync;

  constructor(readonly databasePath: string) {
    ensurePrivateCacheLocation(databasePath);
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.migrate();
    secureCacheFile(databasePath);
  }

  private migrate(): void {
    const currentVersion = Number(
      (this.db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0
    );
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(`Chart cache schema ${currentVersion} is newer than supported version ${SCHEMA_VERSION}`);
    }
    if (currentVersion < 1) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS companies (
          company_code TEXT PRIMARY KEY,
          company_id INTEGER,
          name_local TEXT NOT NULL,
          name_foreign TEXT,
          last_verified_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chart_accounts (
          company_code TEXT NOT NULL,
          account_code TEXT NOT NULL,
          account_id INTEGER NOT NULL,
          name_local TEXT NOT NULL,
          name_foreign TEXT,
          category_code INTEGER,
          category_name TEXT,
          account_type TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (company_code, account_code),
          UNIQUE (company_code, account_id),
          FOREIGN KEY (company_code) REFERENCES companies(company_code) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chart_accounts_name_local
          ON chart_accounts(company_code, name_local);
        CREATE INDEX IF NOT EXISTS idx_chart_accounts_name_foreign
          ON chart_accounts(company_code, name_foreign);
        CREATE TABLE IF NOT EXISTS chart_cache_state (
          company_code TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL DEFAULT 1,
          last_full_sync_at TEXT,
          expires_at TEXT,
          account_count INTEGER,
          source_hash TEXT,
          sync_status TEXT,
          last_error TEXT,
          FOREIGN KEY (company_code) REFERENCES companies(company_code) ON DELETE CASCADE
        );
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  upsertCompany(company: CompanyCacheRecord): void {
    this.db.prepare(`
      INSERT INTO companies(company_code, company_id, name_local, name_foreign, last_verified_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(company_code) DO UPDATE SET
        company_id = excluded.company_id,
        name_local = CASE
          WHEN excluded.name_local = excluded.company_code THEN companies.name_local
          ELSE excluded.name_local
        END,
        name_foreign = COALESCE(excluded.name_foreign, companies.name_foreign),
        last_verified_at = excluded.last_verified_at
    `).run(
      company.companyCode,
      company.companyId ?? null,
      company.nameLocal,
      company.nameForeign ?? null,
      company.lastVerifiedAt
    );
  }

  markSyncing(company: CompanyCacheRecord): void {
    this.upsertCompany(company);
    this.db.prepare(`
      INSERT INTO chart_cache_state(company_code, schema_version, sync_status, last_error)
      VALUES (?, ?, 'syncing', NULL)
      ON CONFLICT(company_code) DO UPDATE SET sync_status = 'syncing', last_error = NULL
    `).run(company.companyCode, SCHEMA_VERSION);
  }

  markError(companyCode: string, message: string): void {
    this.db.prepare(`
      UPDATE chart_cache_state SET sync_status = 'error', last_error = ? WHERE company_code = ?
    `).run(message, companyCode);
  }

  replaceCompanyAccounts(
    company: CompanyCacheRecord,
    accounts: ChartAccount[],
    state: Required<Pick<ChartCacheState, "lastFullSyncAt" | "expiresAt" | "sourceHash">>
  ): void {
    this.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS chart_accounts_staging (
        company_code TEXT NOT NULL,
        account_code TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        name_local TEXT NOT NULL,
        name_foreign TEXT,
        category_code INTEGER,
        category_name TEXT,
        account_type TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        fetched_at TEXT NOT NULL
      );
      DELETE FROM chart_accounts_staging;
    `);
    const insertStaging = this.db.prepare(`
      INSERT INTO chart_accounts_staging(
        company_code, account_code, account_id, name_local, name_foreign,
        category_code, category_name, account_type, is_active, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const account of accounts) {
      insertStaging.run(
        account.companyCode, account.accountCode, account.accountId, account.nameLocal,
        account.nameForeign ?? null, account.categoryCode ?? null, account.categoryName ?? null,
        account.accountType, account.isActive ? 1 : 0, account.fetchedAt
      );
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.upsertCompany(company);
      this.db.prepare("DELETE FROM chart_accounts WHERE company_code = ?").run(company.companyCode);
      this.db.prepare(`
        INSERT INTO chart_accounts
        SELECT * FROM chart_accounts_staging WHERE company_code = ?
      `).run(company.companyCode);
      this.db.prepare(`
        INSERT INTO chart_cache_state(
          company_code, schema_version, last_full_sync_at, expires_at,
          account_count, source_hash, sync_status, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, 'ready', NULL)
        ON CONFLICT(company_code) DO UPDATE SET
          schema_version = excluded.schema_version,
          last_full_sync_at = excluded.last_full_sync_at,
          expires_at = excluded.expires_at,
          account_count = excluded.account_count,
          source_hash = excluded.source_hash,
          sync_status = 'ready',
          last_error = NULL
      `).run(
        company.companyCode, SCHEMA_VERSION, state.lastFullSyncAt, state.expiresAt,
        accounts.length, state.sourceHash
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.exec("DELETE FROM chart_accounts_staging");
    }
  }

  getAccountByCode(companyCode: string, accountCode: string): ChartAccount | undefined {
    const row = this.db.prepare(`
      SELECT * FROM chart_accounts WHERE company_code = ? AND account_code = ?
    `).get(companyCode, accountCode.trim()) as AccountRow | undefined;
    return row ? mapAccount(row) : undefined;
  }

  getAccountCompanyById(accountId: number): string[] {
    return (this.db.prepare(`
      SELECT company_code FROM chart_accounts WHERE account_id = ? ORDER BY company_code
    `).all(accountId) as Array<{ company_code: string }>).map((row) => row.company_code);
  }

  searchAccounts(companyCode: string, query: string, limit = 20): ChartAccount[] {
    const term = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    return (this.db.prepare(`
      SELECT * FROM chart_accounts
      WHERE company_code = ? AND (
        account_code LIKE ? ESCAPE '\\' OR
        name_local LIKE ? ESCAPE '\\' OR
        COALESCE(name_foreign, '') LIKE ? ESCAPE '\\'
      )
      ORDER BY is_active DESC, account_code
      LIMIT ?
    `).all(companyCode, term, term, term, Math.max(1, Math.min(limit, 100))) as unknown as AccountRow[]).map(mapAccount);
  }

  getCacheState(companyCode: string): ChartCacheState | undefined {
    const row = this.db.prepare(`
      SELECT * FROM chart_cache_state WHERE company_code = ?
    `).get(companyCode) as StateRow | undefined;
    if (!row) return undefined;
    return {
      companyCode: row.company_code,
      schemaVersion: row.schema_version,
      lastFullSyncAt: row.last_full_sync_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      accountCount: row.account_count ?? undefined,
      sourceHash: row.source_hash ?? undefined,
      syncStatus: row.sync_status ?? undefined,
      lastError: row.last_error ?? undefined,
    };
  }

  invalidate(companyCode: string): void {
    this.db.prepare(`
      UPDATE chart_cache_state SET expires_at = NULL, sync_status = 'stale' WHERE company_code = ?
    `).run(companyCode);
  }

  close(): void {
    this.db.close();
  }
}

interface AccountRow {
  company_code: string;
  account_code: string;
  account_id: number;
  name_local: string;
  name_foreign: string | null;
  category_code: number | null;
  category_name: string | null;
  account_type: "control" | "sub_account";
  is_active: number;
  fetched_at: string;
}

interface StateRow {
  company_code: string;
  schema_version: number;
  last_full_sync_at: string | null;
  expires_at: string | null;
  account_count: number | null;
  source_hash: string | null;
  sync_status: string | null;
  last_error: string | null;
}

function mapAccount(row: AccountRow): ChartAccount {
  return {
    companyCode: row.company_code,
    accountCode: row.account_code,
    accountId: row.account_id,
    nameLocal: row.name_local,
    nameForeign: row.name_foreign ?? undefined,
    categoryCode: row.category_code ?? undefined,
    categoryName: row.category_name ?? undefined,
    accountType: row.account_type,
    isActive: row.is_active === 1,
    fetchedAt: row.fetched_at,
  };
}

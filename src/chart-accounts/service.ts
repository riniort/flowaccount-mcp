import { createHash } from "crypto";
import type { ChartAccountRepository } from "./repository.js";
import type { ChartAccount, ChartAccountSource, ChartCacheState, CompanyCacheRecord } from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class ChartAccountService {
  private readonly refreshes = new Map<string, Promise<ChartCacheState>>();

  constructor(
    private readonly repository: ChartAccountRepository,
    private readonly source: ChartAccountSource,
    private readonly ttlMs = DEFAULT_TTL_MS
  ) {}

  async ensureChartCache(company: CompanyCacheRecord): Promise<ChartCacheState> {
    const state = this.repository.getCacheState(company.companyCode);
    if (
      state?.syncStatus === "ready" &&
      (state.accountCount ?? 0) > 0 &&
      state.expiresAt &&
      Date.parse(state.expiresAt) > Date.now()
    ) {
      this.repository.upsertCompany(company);
      return state;
    }
    return this.refreshChartCache(company);
  }

  async refreshChartCache(company: CompanyCacheRecord): Promise<ChartCacheState> {
    const existing = this.refreshes.get(company.companyCode);
    if (existing) return existing;
    const refresh = this.refreshInternal(company).finally(() => {
      this.refreshes.delete(company.companyCode);
    });
    this.refreshes.set(company.companyCode, refresh);
    return refresh;
  }

  private async refreshInternal(company: CompanyCacheRecord): Promise<ChartCacheState> {
    this.repository.markSyncing(company);
    try {
      const fetchedAt = new Date().toISOString();
      const sourceAccounts = await this.source.fetchAccounts(company.companyCode);
      if (sourceAccounts.length === 0) {
        throw new Error(`FlowAccount returned no chart accounts for company ${company.companyCode}`);
      }
      const accounts = sourceAccounts.map((account) => ({
        ...account,
        companyCode: company.companyCode,
        accountCode: account.accountCode.trim(),
        fetchedAt,
      }));
      validateAccounts(company.companyCode, accounts);
      const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
      const sourceHash = createHash("sha256")
        .update(JSON.stringify(accounts.map((account) => [
          account.accountCode, account.accountId, account.nameLocal, account.nameForeign,
          account.categoryCode, account.categoryName, account.accountType, account.isActive,
        ])))
        .digest("hex");
      this.repository.replaceCompanyAccounts(company, accounts, {
        lastFullSyncAt: fetchedAt,
        expiresAt,
        sourceHash,
      });
      return this.repository.getCacheState(company.companyCode)!;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.markError(company.companyCode, message);
      throw error;
    }
  }

  getAccountByCode(companyCode: string, accountCode: string): ChartAccount | undefined {
    return this.repository.getAccountByCode(companyCode, accountCode);
  }

  searchAccounts(companyCode: string, query: string, limit?: number): ChartAccount[] {
    return this.repository.searchAccounts(companyCode, query, limit);
  }

  getCacheStatus(companyCode: string): ChartCacheState | undefined {
    return this.repository.getCacheState(companyCode);
  }

  invalidateChartCache(companyCode: string): void {
    this.repository.invalidate(companyCode);
  }

  assertAccountBelongsToCompany(companyCode: string, accountId: number): void {
    const companies = this.repository.getAccountCompanyById(accountId);
    if (companies.length > 0 && !companies.includes(companyCode)) {
      throw new Error(
        `Account ID ${accountId} belongs to cached company ${companies.join(", ")}, not active company ${companyCode}`
      );
    }
  }
}

function validateAccounts(companyCode: string, accounts: ChartAccount[]): void {
  const codes = new Set<string>();
  const ids = new Set<number>();
  for (const account of accounts) {
    if (!account.accountCode || !Number.isSafeInteger(account.accountId) || account.accountId <= 0) {
      throw new Error(`Invalid chart account returned for company ${companyCode}`);
    }
    if (codes.has(account.accountCode)) {
      throw new Error(`Duplicate account code ${account.accountCode} returned for company ${companyCode}`);
    }
    if (ids.has(account.accountId)) {
      throw new Error(`Duplicate account ID ${account.accountId} returned for company ${companyCode}`);
    }
    codes.add(account.accountCode);
    ids.add(account.accountId);
  }
}

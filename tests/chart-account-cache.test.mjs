import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ChartAccountRepository } from "../dist/chart-accounts/repository.js";
import { ChartAccountService } from "../dist/chart-accounts/service.js";
import {
  buildExpenseBody,
  createExpenseWithAccountResolution,
  resolveExpenseAccounts,
} from "../dist/tools/expenses.js";

function account(accountCode, accountId, categoryCode = 5, overrides = {}) {
  const categoryName = ["", "Assets", "Liabilities", "Equity", "Revenue", "Expenses"][categoryCode];
  return {
    accountCode,
    accountId,
    nameLocal: `บัญชี ${accountCode}`,
    nameForeign: `Account ${accountCode}`,
    categoryCode,
    categoryName,
    accountType: "sub_account",
    isActive: true,
    ...overrides,
  };
}

function company(companyCode) {
  return { companyCode, nameLocal: `Company ${companyCode}`, lastVerifiedAt: new Date().toISOString() };
}

function harness(accountsByCompany, ttlMs = 86_400_000) {
  const directory = mkdtempSync(join(tmpdir(), "flowaccount-cache-test-"));
  const databasePath = join(directory, "cache.sqlite");
  const calls = new Map();
  let failure;
  const source = {
    async fetchAccounts(companyCode) {
      calls.set(companyCode, (calls.get(companyCode) ?? 0) + 1);
      if (failure) throw failure;
      return structuredClone(accountsByCompany[companyCode] ?? []);
    },
  };
  const repository = new ChartAccountRepository(databasePath);
  const service = new ChartAccountService(repository, source, ttlMs);
  return {
    service,
    repository,
    calls,
    failWith(error) { failure = error; },
    cleanup() {
      repository.close();
      const resolvedDirectory = resolve(directory);
      assert.ok(resolvedDirectory.startsWith(resolve(tmpdir())));
      rmSync(resolvedDirectory, { recursive: true, force: true });
    },
  };
}

test("separates company caches and preserves dotted/alphanumeric account codes", async () => {
  const h = harness({
    N100: [account("51121.02", 101)],
    N200: [account("21952Z.01", 202, 2)],
  });
  try {
    await h.service.ensureChartCache(company("N100"));
    await h.service.ensureChartCache(company("N200"));
    assert.equal(h.service.getAccountByCode("N100", "51121.02")?.accountId, 101);
    assert.equal(h.service.getAccountByCode("N100", "21952Z.01"), undefined);
    assert.equal(h.service.getAccountByCode("N200", "21952Z.01")?.categoryCode, 2);
    assert.equal(h.service.searchAccounts("N200", "Account 21952Z").length, 1);
  } finally {
    h.cleanup();
  }
});

test("refreshes stale cache and keeps the last complete snapshot after refresh failure", async () => {
  const h = harness({ N100: [account("51121.02", 101)] }, -1);
  try {
    await h.service.ensureChartCache(company("N100"));
    await h.service.ensureChartCache(company("N100"));
    assert.equal(h.calls.get("N100"), 2);
    h.failWith(new Error("upstream unavailable"));
    await assert.rejects(h.service.refreshChartCache(company("N100")), /upstream unavailable/);
    assert.equal(h.service.getAccountByCode("N100", "51121.02")?.accountId, 101);
    assert.equal(h.service.getCacheStatus("N100")?.syncStatus, "error");
    assert.match(h.service.getCacheStatus("N100")?.lastError ?? "", /upstream unavailable/);
  } finally {
    h.cleanup();
  }
});

test("blocks an account ID cached only under another company", async () => {
  const h = harness({
    N100: [account("51121.02", 101)],
    N200: [account("51121.02", 202)],
  });
  try {
    await h.service.ensureChartCache(company("N100"));
    await h.service.ensureChartCache(company("N200"));
    assert.throws(
      () => h.service.assertAccountBelongsToCompany("N100", 202),
      /belongs to cached company N200/
    );
  } finally {
    h.cleanup();
  }
});

test("resolves expense account IDs and categories from codes", async () => {
  const h = harness({
    N100: [account("51121.02", 101, 5), account("21399", 102, 2)],
  });
  try {
    const resolved = await resolveExpenseAccounts({
      contactName: "Supplier",
      contactBranch: "00000",
      publishedOn: "2026-08-21",
      items: [{
        description: "Supplies",
        quantity: 1,
        pricePerUnit: 100,
        vatType: 1,
        expenseDebitCode: "51121.02",
        expenseCreditCode: "21399",
      }],
      discount: 0,
      isVatInclusive: true,
      reference: "INV-001",
      receivedTaxForm: 1,
    }, company("N100"), h.service);
    assert.equal(resolved.items[0].expenseDebitId, 101);
    assert.equal(resolved.items[0].expenseDebitCategory, 5);
    assert.equal(resolved.items[0].expenseCreditId, 102);
    assert.equal(resolved.items[0].expenseCreditCategory, 2);
  } finally {
    h.cleanup();
  }
});

test("rejects a supplied ID that does not match the active company's account code", async () => {
  const h = harness({
    N100: [account("51121.02", 101, 5), account("21399", 102, 2)],
    N200: [account("OTHER", 202, 5)],
  });
  try {
    await h.service.ensureChartCache(company("N200"));
    await assert.rejects(resolveExpenseAccounts({
      contactName: "Supplier",
      contactBranch: "00000",
      publishedOn: "2026-08-21",
      items: [{
        description: "Supplies",
        quantity: 1,
        pricePerUnit: 100,
        vatType: 1,
        expenseDebitCode: "51121.02",
        expenseDebitId: 202,
        expenseCreditCode: "21399",
      }],
      discount: 0,
      isVatInclusive: true,
      reference: "INV-002",
      receivedTaxForm: 1,
    }, company("N100"), h.service), /not active company N100/);
  } finally {
    h.cleanup();
  }
});

test("refreshes and retries expense creation once after an API account mismatch", async () => {
  const h = harness({
    N100: [account("51121.02", 101, 5), account("21399", 102, 2)],
  });
  const input = {
    contactName: "Supplier",
    contactBranch: "00000",
    publishedOn: "2026-08-21",
    items: [{
      description: "Supplies",
      quantity: 1,
      pricePerUnit: 100,
      vatType: 3,
      expenseDebitCode: "51121.02",
      expenseCreditCode: "21399",
    }],
    discount: 0,
    isVatInclusive: true,
    reference: "INV-RETRY",
    receivedTaxForm: 1,
  };
  const resolved = {
    ...input,
    items: [{
      ...input.items[0],
      expenseDebitId: 101,
      expenseDebitCategory: 5,
      expenseCreditId: 102,
      expenseCreditCategory: 2,
    }],
  };
  const expectedBody = buildExpenseBody(resolved);
  let posts = 0;
  const http = {
    async get(endpoint) {
      if (endpoint.path === "/th/expenses") return { data: { list: [], total: 0 } };
      return {
        data: {
          list: [{ ...expectedBody, recordId: 9001, reference: input.reference }],
        },
      };
    },
    async post() {
      posts += 1;
      if (posts === 1) {
        throw { response: { status: 422, data: { message: "account ID mismatch" } } };
      }
      return { data: { recordId: 9001, reference: input.reference } };
    },
    async delete() {
      throw new Error("delete should not be called");
    },
  };
  try {
    const result = await createExpenseWithAccountResolution(
      http, "th", input, company("N100"), h.service
    );
    assert.equal(result.data.recordId, 9001);
    assert.equal(posts, 2);
    assert.equal(h.calls.get("N100"), 2);
  } finally {
    h.cleanup();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  attachPp36SupplierInvoice,
  buildAiSubscriptionExpenseInput,
  buildExpenseBody,
  buildPp36SupplierInvoice,
  expenseCreateSchema,
  rollbackExpenseAndVerify,
} from "../dist/tools/expenses.js";
import {
  buildExpenseDuplicateInput,
  verifyExpenseDuplicateTotals,
} from "../dist/tools/duplicate.js";

const accounts = {
  expenseDebitId: 450020880,
  expenseDebitCode: "51121.01",
  expenseCreditId: 410442507,
  expenseCreditCode: "21399",
};

function build(items, isVatInclusive = false, discount = 0) {
  return buildExpenseBody({
    contactName: "Supplier",
    contactTaxId: "0105556008221",
    publishedOn: "2026-07-09",
    reference: "TEST-INVOICE",
    isVatInclusive,
    discount,
    items: items.map((item) => ({ ...accounts, ...item })),
  });
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("calculates VAT after an overall document discount", () => {
  const body = build([
    { description: "item 1", quantity: 1, pricePerUnit: 5184, vatType: 1 },
    { description: "item 2", quantity: 2, pricePerUnit: 4032, vatType: 1 },
  ], false, 518.4);

  assert.equal(body.subTotal, 13248);
  assert.equal(body.discount, 518.4);
  assert.equal(body.totalAfterDiscount, 12729.6);
  assert.equal(body.vatableAmount, 12729.6);
  assert.equal(body.vatValue, 891.07);
  assert.equal(body.total, 13620.67);
  assert.deepEqual(body.productItems.map((item) => item.total), [5184, 8064]);
  assert.deepEqual(body.productItems.map((item) => item.discountPerItem), [0, 0]);
  assert.equal(body.documentDiscountTypes, 3);
});

test("allocates an overall discount proportionally across VAT and exempt totals", () => {
  const body = build([
    { description: "VAT", quantity: 2, pricePerUnit: 100, vatType: 1 },
    { description: "exempt", quantity: 1, pricePerUnit: 50, vatType: 2 },
  ], false, 25);

  assert.equal(body.subTotal, 250);
  assert.equal(body.discount, 25);
  assert.equal(body.totalAfterDiscount, 225);
  assert.equal(body.vatableAmount, 180);
  assert.equal(body.exemptAmount, 45);
  assert.equal(body.vatValue, 12.6);
  assert.equal(body.total, 237.6);
});

test("extracts VAT after discount when prices include VAT", () => {
  const body = build([
    { description: "VAT inclusive", quantity: 1, pricePerUnit: 107, vatType: 1 },
  ], true, 10.7);

  closeTo(body.vatableAmount, 90);
  closeTo(body.vatValue, 6.3);
  closeTo(body.total, 96.3);
});

test("rounds every persisted monetary total to two decimals", () => {
  const body = build([
    { description: "fractional VAT", quantity: 3, pricePerUnit: 33.333, vatType: 1 },
  ]);

  assert.equal(body.subTotal, 100);
  assert.equal(body.vatableAmount, 100);
  assert.equal(body.vatValue, 7);
  assert.equal(body.total, 107);
  assert.equal(body.total, body.totalWithoutVat + body.vatValue);
});

test("uses decimal half-up rounding for multiplication ties", () => {
  const body = build([
    { description: "half-satang tie", quantity: 3, pricePerUnit: 1.005, vatType: 1 },
  ]);

  assert.equal(body.productItems[0].total, 3.02);
  assert.equal(body.subTotal, 3.02);
  assert.equal(body.vatValue, 0.21);
  assert.equal(body.total, 3.23);
});

test("rejects an overall discount larger than the document subtotal", () => {
  assert.throws(
    () => build([{ description: "invalid", quantity: 1, pricePerUnit: 10, vatType: 1 }], false, 11),
    /cannot exceed/
  );
});

test("does not multiply the overall discount by item quantity", () => {
  const body = build([
    { description: "quantity greater than one", quantity: 6, pricePerUnit: 72, vatType: 1 },
  ], false, 21.6);

  assert.equal(body.subTotal, 432);
  assert.equal(body.discount, 21.6);
  assert.equal(body.totalAfterDiscount, 410.4);
  assert.equal(body.productItems[0].discountPerItem, 0);
});

test("schema rejects invalid VAT types, quantities, prices, and sub-satang discounts", () => {
  const valid = {
    contactName: "Supplier",
    publishedOn: "2026-07-09",
    reference: "SCHEMA-TEST",
    items: [{
      ...accounts,
      description: "item",
      quantity: 1,
      pricePerUnit: 10,
      vatType: 1,
    }],
  };

  assert.equal(expenseCreateSchema.safeParse(valid).success, true);
  assert.equal(expenseCreateSchema.safeParse({ ...valid, discount: 0.004 }).success, false);
  assert.equal(expenseCreateSchema.safeParse({
    ...valid,
    items: [{ ...valid.items[0], vatType: 99 }],
  }).success, false);
  assert.equal(expenseCreateSchema.safeParse({
    ...valid,
    items: [{ ...valid.items[0], quantity: 0 }],
  }).success, false);
  assert.equal(expenseCreateSchema.safeParse({
    ...valid,
    items: [{ ...valid.items[0], pricePerUnit: -1 }],
  }).success, false);
});

test("uses the no-discount document mode and constructs received VAT data", () => {
  const body = build([
    { description: "VAT", quantity: 1, pricePerUnit: 100, vatType: 1 },
  ]);

  assert.equal(body.documentDiscountTypes, 1);
  assert.equal(body.discount, 0);
  assert.equal(body.supplierInvoices.length, 1);
  assert.equal(body.supplierInvoices[0].total, 100);
  assert.equal(body.supplierInvoices[0].vatValue, 7);
});

test("builds an OpenAI expense at VAT 0 and a separate PP.36 tax record", () => {
  const subscription = {
    provider: "openai",
    invoiceNumber: "2DFD044C-0014",
    receiptNumber: "2897-5969-7339",
    paidOn: "2026-02-07",
    subscriptionStart: "2026-02-07",
    subscriptionEnd: "2026-03-07",
    amountUsd: 20,
    amountThb: 634.30,
    conversionSource: "bot_reference_rate",
    sellerHasNoThaiPermanentEstablishment: true,
    exchangeRate: 31.715,
    exchangeRateDate: "2026-02-06",
    paymentCardLast4: "8112",
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  };
  const input = buildAiSubscriptionExpenseInput(subscription);
  const body = buildExpenseBody({
    ...input,
    items: input.items.map((item) => ({
      ...item,
      expenseDebitId: accounts.expenseDebitId,
      expenseDebitCategory: 5,
      expenseCreditId: accounts.expenseCreditId,
      expenseCreditCategory: 2,
    })),
  });

  assert.equal(input.contactName, "OpenAI OpCo, LLC");
  assert.equal(input.contactTaxId, "0993000528824");
  assert.equal(input.reference, "2897-5969-7339");
  assert.equal(input.items[0].expenseDebitCode, "53113");
  assert.equal(input.items[0].expenseCreditCode, "21379.01");
  assert.equal(input.items[0].vatType, 3);
  assert.equal(body.exemptAmount, 634.30);
  assert.equal(body.vatableAmount, 0);
  assert.equal(body.vatValue, 0);
  assert.equal(body.total, 634.30);
  assert.deepEqual(body.supplierInvoices, []);
  const pp36 = buildPp36SupplierInvoice(subscription, 59863734);
  assert.equal(pp36.referenceDocumentId, 59863734);
  assert.equal(pp36.total, 634.30);
  assert.equal(pp36.vatValue, 44.40);
  assert.equal(pp36.taxForm, 3);
  assert.match(input.remarks, /PP\.36 due 2026-03-07/);
});

test("attaches and verifies PP.36 independently from the base-only expense", async () => {
  const subscription = {
    provider: "openai",
    invoiceNumber: "2DFD044C-0014",
    receiptNumber: "2897-5969-7339",
    paidOn: "2026-02-07",
    subscriptionStart: "2026-02-07",
    subscriptionEnd: "2026-03-07",
    amountUsd: 20,
    amountThb: 634.30,
    conversionSource: "card_statement",
    sellerHasNoThaiPermanentEstablishment: true,
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  };
  let posted;
  const http = {
    async post(path, body) {
      posted = { path, body };
      return { data: { ...body } };
    },
  };
  await attachPp36SupplierInvoice(http, "th", 123, subscription);
  assert.match(posted.path.path, /\/th\/expenses\/123\/attach-invoice$/);
  assert.equal(posted.body.total, 634.30);
  assert.equal(posted.body.vatValue, 44.40);
  assert.equal(posted.body.taxForm, 3);
});

test("rejects a mismatched PP.36 response", async () => {
  const subscription = {
    provider: "anthropic",
    invoiceNumber: "INV-1",
    receiptNumber: "REC-1",
    paidOn: "2026-07-08",
    subscriptionStart: "2026-07-08",
    subscriptionEnd: "2026-08-08",
    amountUsd: 20,
    amountThb: 671.25,
    conversionSource: "card_statement",
    sellerHasNoThaiPermanentEstablishment: true,
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  };
  const http = { async post() { return { data: { total: 718.24, vatValue: 46.99, documentSerial: "INV-1", taxForm: 3 } }; } };
  await assert.rejects(
    attachPp36SupplierInvoice(http, "th", 123, subscription),
    /PP\.36 attachment verification failed/
  );
});

test("rollback verifies a successful delete instead of trusting HTTP 200", async () => {
  const http = {
    async delete() { return { status: true }; },
    async get() { return { data: { list: [{ recordId: 123, status: 1, isDelete: false }] } }; },
  };
  await assert.rejects(
    rollbackExpenseAndVerify(http, "th", 123),
    /still exists/
  );
});

test("builds an Anthropic subscription from the actual card-statement amount", () => {
  const input = buildAiSubscriptionExpenseInput({
    provider: "anthropic",
    invoiceNumber: "JGHFXMVI-0003",
    receiptNumber: "2652-3792-8777",
    paidOn: "2026-07-08",
    subscriptionStart: "2026-07-08",
    subscriptionEnd: "2026-08-08",
    amountUsd: 20,
    amountThb: 671.25,
    conversionSource: "card_statement",
    sellerHasNoThaiPermanentEstablishment: true,
    paymentCardLast4: "8112",
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  });

  assert.equal(input.contactName, "Anthropic, PBC");
  assert.equal(input.contactTaxId, "0993000497902");
  assert.equal(input.items[0].pricePerUnit, 671.25);
  assert.match(input.remarks, /actual card-statement amount/);
  assert.match(input.remarks, /PP\.36 due 2026-08-07/);
});

test("supports another foreign AI provider using exact invoice legal details", () => {
  const subscription = {
    provider: "other",
    providerName: "Example Foreign AI Co., Ltd.",
    providerAddress: "1 Example Road, Singapore",
    providerTaxId: "FOREIGN-TAX-123",
    serviceName: "Qwen API Subscription",
    invoiceNumber: "QWEN-INV-001",
    receiptNumber: "QWEN-REC-001",
    paidOn: "2026-08-15",
    subscriptionStart: "2026-08-15",
    subscriptionEnd: "2026-09-15",
    amountUsd: 10,
    amountThb: 330,
    conversionSource: "card_statement",
    sellerHasNoThaiPermanentEstablishment: true,
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  };
  const input = buildAiSubscriptionExpenseInput(subscription);
  const pp36 = buildPp36SupplierInvoice(subscription, 456);

  assert.equal(input.contactName, "Example Foreign AI Co., Ltd.");
  assert.equal(input.contactAddress, "1 Example Road, Singapore");
  assert.equal(input.contactTaxId, "FOREIGN-TAX-123");
  assert.equal(input.items[0].vatType, 3);
  assert.match(input.items[0].description, /Qwen API Subscription/);
  assert.equal(pp36.contactName, "Example Foreign AI Co., Ltd.");
  assert.equal(pp36.contactTaxId, "FOREIGN-TAX-123");
  assert.equal(pp36.total, 330);
  assert.equal(pp36.vatValue, 23.10);
});

test("does not guess legal details for another AI provider", () => {
  assert.throws(() => buildAiSubscriptionExpenseInput({
    provider: "other",
    providerName: "z.ai",
    invoiceNumber: "INV",
    receiptNumber: "REC",
    paidOn: "2026-08-15",
    subscriptionStart: "2026-08-15",
    subscriptionEnd: "2026-09-15",
    amountUsd: 10,
    amountThb: 330,
    conversionSource: "card_statement",
    sellerHasNoThaiPermanentEstablishment: true,
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  }), /requires providerAddress, providerTaxId, serviceName/);
});

test("rejects incomplete or inconsistent BOT conversions", () => {
  const base = {
    provider: "openai",
    invoiceNumber: "INV",
    receiptNumber: "REC",
    paidOn: "2026-06-07",
    subscriptionStart: "2026-06-07",
    subscriptionEnd: "2026-07-07",
    amountUsd: 20,
    amountThb: 653.32,
    conversionSource: "bot_reference_rate",
    sellerHasNoThaiPermanentEstablishment: true,
    expenseDebitCode: "53113",
    expenseCreditCode: "21379.01",
  };
  assert.throws(() => buildAiSubscriptionExpenseInput(base), /requires both exchangeRate/);
  assert.throws(() => buildAiSubscriptionExpenseInput({
    ...base,
    exchangeRate: 32,
    exchangeRateDate: "2026-06-05",
  }), /does not match amountUsd x exchangeRate/);
  assert.throws(() => buildAiSubscriptionExpenseInput({
    ...base,
    amountThb: 0,
    exchangeRate: 0.01,
    exchangeRateDate: "2026-06-05",
  }), /greater than 0/);
});

test("does not create received VAT data for fully exempt documents", () => {
  const body = build([
    { description: "exempt", quantity: 2, pricePerUnit: 50, vatType: 2 },
  ], false, 10);

  assert.equal(body.subTotal, 100);
  assert.equal(body.discount, 10);
  assert.equal(body.exemptAmount, 90);
  assert.equal(body.vatValue, 0);
  assert.equal(body.total, 90);
  assert.equal(body.isVat, false);
  assert.deepEqual(body.supplierInvoices, []);
});

test("balances an inclusive mixed-VAT document after an overall discount", () => {
  const body = build([
    { description: "VAT inclusive", quantity: 1, pricePerUnit: 107, vatType: 1 },
    { description: "exempt", quantity: 1, pricePerUnit: 50, vatType: 2 },
  ], true, 15.7);

  assert.equal(body.subTotal, 157);
  assert.equal(body.discount, 15.7);
  assert.equal(body.vatableAmount, 90);
  assert.equal(body.vatValue, 6.3);
  assert.equal(body.exemptAmount, 45);
  assert.equal(body.total, 141.3);
});

test("handles a fully discounted VAT document without creating zero-value VAT data", () => {
  const body = build([
    { description: "fully discounted", quantity: 1, pricePerUnit: 100, vatType: 1 },
  ], false, 100);

  assert.equal(body.totalAfterDiscount, 0);
  assert.equal(body.vatableAmount, 0);
  assert.equal(body.vatValue, 0);
  assert.equal(body.total, 0);
  assert.equal(body.isVat, false);
  assert.deepEqual(body.supplierInvoices, []);
});

test("duplicates the authoritative document discount without multiplying item discount metadata", () => {
  const source = {
    contactName: "Supplier",
    contactTaxId: "0105556008221",
    discount: 43.2,
    subTotal: 432,
    totalAfterDiscount: 388.8,
    vatableAmount: 388.8,
    vatValue: 27.22,
    total: 416.02,
    isVatInclusive: false,
    productItems: [{
      expenseDescription: "discounted quantity",
      quantity: 6,
      pricePerUnit: 72,
      discountPerItem: 3.6,
      vatRate: 7,
      expenseDebitId: accounts.expenseDebitId,
      expenseDebitCode: accounts.expenseDebitCode,
      expenseCreditId: accounts.expenseCreditId,
      expenseCreditCode: accounts.expenseCreditCode,
    }],
  };
  const input = buildExpenseDuplicateInput(source, "2026-08-21", "DUPLICATE-TEST");

  assert.equal(input.discount, 43.2);
  assert.equal("discount" in input.items[0], false);
  const body = buildExpenseBody(input);
  assert.equal(body.subTotal, 432);
  assert.equal(body.discount, 43.2);
  assert.equal(body.totalAfterDiscount, 388.8);
  assert.equal(body.productItems[0].discountPerItem, 0);
  assert.doesNotThrow(() => verifyExpenseDuplicateTotals(source, input));
  assert.throws(
    () => verifyExpenseDuplicateTotals({ ...source, total: 416.03 }, input),
    /grand total would change/
  );
});

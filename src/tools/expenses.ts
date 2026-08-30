import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Decimal } from "decimal.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { BASE, endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";
import type { ChartAccountService } from "../chart-accounts/service.js";
import type { ChartAccount, CompanyCacheRecord } from "../chart-accounts/types.js";
import { formatListResponse, DOC_FIELDS, EXPENSE_STATUS, buildDocListParams } from "../utils/list-formatter.js";
import { uploadDocumentAttachment } from "./attachments.js";

// Account IDs and categories are accepted for backward compatibility, but are
// always checked against the active company's authoritative chart cache.
const expenseItemSchema = z.object({
  description: z.string().describe("Item description"),
  quantity: z.number().positive().describe("Quantity (must be greater than zero)"),
  pricePerUnit: z.number().nonnegative().describe("Price per unit (cannot be negative)"),
  vatType: z.union([z.literal(1), z.literal(2), z.literal(3)])
    .optional().default(1).describe("1=Vat, 2=VatExempt, 3=NoVat"),
  // Accountant-category mode is mandatory. Business-category IDs are not
  // exposed because accepting them would allow a document to use the wrong UI mode.
  expenseDebitId: z.number().positive().optional().describe("Optional debit account ID; resolved and verified from expenseDebitCode"),
  expenseDebitCode: z.string().trim().min(1).describe("Required debit account code; ID and category are resolved automatically"),
  expenseCreditId: z.number().positive().optional().describe("Optional credit account ID; resolved and verified from expenseCreditCode"),
  expenseCreditCode: z.string().trim().min(1).describe("Required credit account code; ID and category are resolved automatically"),
  expenseDebitCategory: z.number().int().min(1).max(5).optional().describe("Optional debit category; resolved and verified from the account code"),
  expenseCreditCategory: z.number().int().min(1).max(5).optional().describe("Optional credit category; resolved and verified from the account code"),
});

const expenseCreateFields = {
  contactName: z.string().describe("Supplier/vendor name"),
  contactTaxId: z.string().optional().describe("Supplier tax ID"),
  contactAddress: z.string().optional().describe("Supplier address"),
  contactBranch: z.string().trim().min(1).optional().default("00000").describe(
    "Supplier branch. Branch numbers are zero-padded to 5 digits (for example 10 becomes 00010); head-office labels such as HQ, main branch, and headquarter become 00000"
  ),
  publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
  dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)"),
  items: z.array(expenseItemSchema).min(1).describe("Expense line items"),
  discount: z.number().nonnegative().multipleOf(0.01).optional().default(0).describe(
    "Absolute discount amount for the whole expense document. VAT is calculated after this discount."
  ),
  isVatInclusive: z.boolean().optional().default(true).describe("Prices include VAT?"),
  reference: z.string().trim().min(1).describe(
    "Required source document number; stored in FlowAccount field เลขที่อ้างอิง (reference)"
  ),
  remarks: z.string().optional().describe("Remarks/notes shown on document"),
  internalNotes: z.string().optional().describe("Internal notes"),
  receivedTaxInvoiceNumber: z.string().trim().min(1).optional().describe(
    "เลขที่ใบกำกับภาษีที่ได้รับ; used only when calculated VAT is greater than 0 and defaults to reference if omitted"
  ),
  receivedTaxInvoiceDate: z.string().optional().describe(
    "วันที่ใบกำกับภาษีที่ได้รับ (yyyy-MM-dd); defaults to publishedOn"
  ),
  receivedTaxForm: z.number().int().optional().default(1).describe(
    "FlowAccount tax form code for the received supplier invoice (default 1)"
  ),
};

const aiSubscriptionExpenseFields = {
  provider: z.enum(["openai", "anthropic", "other"]).describe(
    "AI subscription provider. Use other for z.ai, Qwen, or any other foreign AI service"
  ),
  providerName: z.string().trim().min(1).optional().describe(
    "Legal supplier name; required when provider=other (use the invoicing entity, not merely the product brand)"
  ),
  providerAddress: z.string().trim().min(1).optional().describe(
    "Foreign supplier address; required when provider=other"
  ),
  providerTaxId: z.string().trim().min(1).optional().describe(
    "Supplier tax/registration ID used in FlowAccount PP.36; required when provider=other"
  ),
  serviceName: z.string().trim().min(1).optional().describe(
    "Subscription/service description; required when provider=other, for example z.ai API Subscription or Qwen Subscription"
  ),
  invoiceNumber: z.string().trim().min(1).describe("Provider invoice number"),
  receiptNumber: z.string().trim().min(1).describe("Provider receipt number; stored as the expense reference"),
  paidOn: z.string().describe("Payment date (yyyy-MM-dd)"),
  subscriptionStart: z.string().describe("Subscription period start (yyyy-MM-dd)"),
  subscriptionEnd: z.string().describe("Subscription period end (yyyy-MM-dd)"),
  amountUsd: z.number().positive().describe("Provider charge in USD"),
  amountThb: z.number().positive().multipleOf(0.01).describe(
    "Expense/VAT base in THB. Prefer the actual card-statement amount; otherwise use amountUsd multiplied by the BOT reference rate"
  ),
  conversionSource: z.enum(["card_statement", "bot_reference_rate"]).describe(
    "How amountThb was determined"
  ),
  sellerHasNoThaiPermanentEstablishment: z.literal(true).describe(
    "Required confirmation that the foreign seller has no permanent establishment in Thailand; this tool records no withholding tax"
  ),
  exchangeRate: z.number().positive().optional().describe(
    "THB per USD; required when conversionSource is bot_reference_rate"
  ),
  exchangeRateDate: z.string().optional().describe(
    "BOT reference-rate date (yyyy-MM-dd); required when conversionSource is bot_reference_rate and may be the prior business day"
  ),
  paymentCardLast4: z.string().regex(/^\d{4}$/).optional().describe("Last four digits of the payment card"),
  expenseDebitCode: z.string().trim().min(1).optional().default("53113").describe(
    "Software/application expense account code"
  ),
  expenseCreditCode: z.string().trim().min(1).optional().default("21379.01").describe(
    "Credit-card or bank account code"
  ),
  pp36DueDate: z.string().optional().describe(
    "PP.36 filing due date (yyyy-MM-dd); defaults to the 7th of the following month"
  ),
  filePath: z.string().min(1).optional().describe("Optional absolute path of the provider receipt PDF"),
};

const aiSubscriptionExpenseSchema = z.object(aiSubscriptionExpenseFields);
export type AiSubscriptionExpenseInput = z.infer<typeof aiSubscriptionExpenseSchema>;

export const expenseCreateSchema = z.object(expenseCreateFields);
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
const referencesInFlight = new Set<string>();

type ExpenseRecord = Record<string, unknown> & {
  recordId?: number;
  reference?: string;
  documentSerial?: string;
  status?: number;
  isDelete?: boolean;
  supplierInvoices?: Array<Record<string, unknown>>;
  productItems?: Array<Record<string, unknown>>;
};

function normalizeContactBranch(value?: string): string {
  const branch = (value || "00000").trim();
  if (/^(สำนักงานใหญ่|head\s*office|main\s*branch|hq|headquarters?)$/i.test(branch)) {
    return "00000";
  }

  const branchNumber = branch.match(/^(?:(?:สาขา|branch)\s*[:#-]?\s*)?(\d{1,5})$/i)?.[1];
  if (!branchNumber) {
    throw new Error(
      'contactBranch must be a branch number from 0 to 99999 or a head-office label such as "สำนักงานใหญ่", "Head Office", "Main Branch", "HQ", or "Headquarter"'
    );
  }
  return branchNumber.padStart(5, "0");
}

/** Decimal half-up helpers: never perform money arithmetic with binary floats. */
export function roundMoney(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function sumMoney(values: Decimal.Value[]): number {
  return roundMoney(values.reduce<Decimal>((sum, value) => sum.plus(value), new Decimal(0)));
}

function subtractMoney(left: Decimal.Value, right: Decimal.Value): number {
  return roundMoney(new Decimal(left).minus(right));
}

function multiplyMoney(left: Decimal.Value, right: Decimal.Value): number {
  return roundMoney(new Decimal(left).times(right));
}

function divideMoney(left: Decimal.Value, right: Decimal.Value): number {
  return roundMoney(new Decimal(left).dividedBy(right));
}

export async function findExpenseByExactReference(
  http: FlowAccountHttpClient,
  culture: string,
  reference: string
): Promise<ExpenseRecord | undefined> {
  const wanted = reference.trim();
  const pageSize = 100;
  for (let page = 1; page <= 100; page++) {
    const result = await http.get<{
      data?: { list?: ExpenseRecord[]; total?: number };
    }>(endpoints.expenses.list(culture), {
      ...buildDocListParams({ page, limit: pageSize, filterStatus: 0 }),
      searchString: wanted,
    });
    const list = result?.data?.list ?? [];
    for (const candidate of list) {
      if (String(candidate.reference ?? "").trim() === wanted) return candidate;
      if (candidate.recordId && candidate.reference == null) {
        const detail = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
          endpoints.expenses.get(culture, candidate.recordId)
        );
        const record = detail?.data?.list?.[0];
        if (record && String(record.reference ?? "").trim() === wanted) return record;
      }
    }
    const total = result?.data?.total ?? list.length;
    if (page * pageSize >= total || list.length === 0) break;
  }
  return undefined;
}

function toProductItem(item: z.infer<typeof expenseItemSchema>) {
  if (!item.expenseDebitId || !item.expenseCreditId) {
    throw new Error("Expense account codes must be resolved before building the request body");
  }
  const vatRate = item.vatType === 1 ? 7 : 0;
  const grossTotal = multiplyMoney(item.pricePerUnit, item.quantity);
  return {
    expenseDescription: item.description,
    quantity: item.quantity,
    pricePerUnit: String(item.pricePerUnit),
    // Keep every item gross. Expense discounts are controlled only by the
    // document-level discount so quantity cannot accidentally multiply them.
    total: grossTotal,
    discountPerItem: 0,
    discountPerItemValue: 0,
    productDiscountTypes: 0,
    vatRate,
    withHeldPerItem: 0,
    // The user's FlowAccount workflow uses the accountant category selector,
    // which is driven directly by the debit/credit chart-of-account fields.
    expenseCategoryId: 0,
    expenseSystemCode: null,
    expenseDebitId: item.expenseDebitId,
    expenseDebitCode: item.expenseDebitCode,
    expenseCreditId: item.expenseCreditId,
    expenseCreditCode: item.expenseCreditCode,
    expenseDebitCategory: item.expenseDebitCategory ?? 5,
    expenseCreditCategory: item.expenseCreditCategory ?? 2,
  };
}

export function buildExpenseBody(input: ExpenseCreateInput) {
  const {
    items, discount: inputDiscount, publishedOn, dueDate, isVatInclusive,
    reference, contactBranch,
    receivedTaxInvoiceNumber, receivedTaxInvoiceDate, receivedTaxForm,
    ...rest
  } = input;
  const normalizedContactBranch = normalizeContactBranch(contactBranch);
  const productItems = items.map((item, i) => ({ no: i, ...toProductItem(item) }));
  const pubDate = publishedOn.includes("T") ? publishedOn : `${publishedOn}T00:00:00`;
  const due = dueDate
    ? (dueDate.includes("T") ? dueDate : `${dueDate}T00:00:00`)
    : pubDate;
  const lineAmounts = items.map((item, index) => ({
    gross: productItems[index].total,
    isVat: item.vatType === 1,
  }));
  const subTotal = sumMoney(lineAmounts.map((item) => item.gross));
  const discount = roundMoney(inputDiscount ?? 0);
  if (discount > subTotal) {
    throw new Error(
      `Expense document discount (${discount}) cannot exceed its gross subtotal (${subTotal})`
    );
  }
  const totalAfterDiscount = subtractMoney(subTotal, discount);
  const taxableGross = sumMoney(
    lineAmounts.filter((item) => item.isVat).map((item) => item.gross)
  );
  const exemptGross = sumMoney(
    lineAmounts.filter((item) => !item.isVat).map((item) => item.gross)
  );
  // FlowAccount's overall discount applies to the whole document. Allocate it
  // proportionally only for VAT-base calculation; keep the remainder on the
  // exempt side so the two-decimal checksum always balances.
  const taxableDiscount = subTotal > 0
    ? divideMoney(new Decimal(discount).times(taxableGross), subTotal)
    : 0;
  const exemptDiscount = subtractMoney(discount, taxableDiscount);
  const vatGross = subtractMoney(taxableGross, taxableDiscount);
  const exemptAmount = subtractMoney(exemptGross, exemptDiscount);
  const vatableAmount = isVatInclusive ? divideMoney(vatGross, 1.07) : vatGross;
  const vatValue = isVatInclusive
    ? subtractMoney(vatGross, vatableAmount)
    : multiplyMoney(vatableAmount, 0.07);
  const totalWithoutVat = sumMoney([exemptAmount, vatableAmount]);
  const total = sumMoney([totalWithoutVat, vatValue]);
  const hasVat = vatGross > 0;
  const supplierInvoices = hasVat ? [{
    documentDate: receivedTaxInvoiceDate
      ? (receivedTaxInvoiceDate.includes("T") ? receivedTaxInvoiceDate : `${receivedTaxInvoiceDate}T00:00:00`)
      : pubDate,
    documentSerial: (receivedTaxInvoiceNumber || reference).trim(),
    referenceDocumentType: 13,
    contactBranch: normalizedContactBranch,
    contactName: input.contactName,
    contactTaxId: input.contactTaxId || "",
    // FlowAccount labels supplierInvoices.total as "มูลค่าที่จ่ายจริง" in the
    // received-tax-invoice UI. It is the taxable base, not base plus VAT.
    // Sending the expense grand total makes PP.36 display an overstated base.
    total: vatableAmount,
    vatValue,
    confirmSave: false,
    taxForm: receivedTaxForm ?? 1,
  }] : [];
  return {
    documentType: 13, ...rest, contactBranch: normalizedContactBranch,
    reference, publishedOn: pubDate, dueDate: due,
    subTotal, totalAfterDiscount, exemptAmount, vatableAmount, vatValue,
    totalWithoutVat, total, vatRate: hasVat ? 7 : 0, isVat: hasVat,
    isVatInclusive: hasVat ? isVatInclusive : false, isReCalculate: true,
    // Type 3 is an absolute document discount in FlowAccount. We keep inline
    // discount disabled so item totals remain gross and VAT is calculated from
    // totalAfterDiscount, matching the expense UI and received tax invoice.
    documentDiscountTypes: discount > 0 ? 3 : 1,
    discount,
    discountPercentage: 0,
    isDicountAsPercentage: false,
    useInlineDiscount: false,
    withholdingTaxAmount: 0, withHeld: 0,
    expenseCategoryViewType: 1, status: 1, productItems, supplierInvoices,
  };
}

export async function createExpenseGuarded(
  http: FlowAccountHttpClient,
  culture: string,
  input: ExpenseCreateInput
) {
  const reference = input.reference.trim();
  const previewBody = buildExpenseBody({ ...input, reference });
  if (Number(previewBody.vatValue) > 0 && !input.contactTaxId?.trim()) {
    throw new Error(
      "VAT expense requires contactTaxId so FlowAccount can retain received input-tax VAT"
    );
  }
  if (referencesInFlight.has(reference)) {
    throw new Error(`Duplicate expense blocked: reference "${reference}" is already being created`);
  }
  referencesInFlight.add(reference);
  try {
    const duplicate = await findExpenseByExactReference(http, culture, reference);
    if (duplicate) {
      throw new Error(
        `Duplicate expense blocked: reference "${reference}" already exists` +
        ` (recordId=${duplicate.recordId ?? "unknown"}, documentSerial=${duplicate.documentSerial ?? "unknown"})`
      );
    }
    const result = await http.post<{ data?: ExpenseRecord }>(
      endpoints.expenses.create(culture), buildExpenseBody({ ...input, reference })
    );
    const recordId = result?.data?.recordId;
    if (!recordId) throw new Error("Expense creation returned no recordId");
    if (String(result?.data?.reference ?? "").trim() !== reference) {
      let cleanupMessage = " The invalid record was deleted.";
      try {
        await rollbackExpenseAndVerify(http, culture, recordId);
      } catch (cleanupError) {
        cleanupMessage = ` Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      throw new Error(
        `Expense reference verification failed for record ${recordId}: expected "${reference}", got "${result?.data?.reference ?? ""}".${cleanupMessage}`
      );
    }
    try {
      const expectedBody = buildExpenseBody({ ...input, reference });
      if (Number(expectedBody.vatValue) > 0) {
        const current = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
          endpoints.expenses.get(culture, recordId)
        );
        const saved = current?.data?.list?.[0];
        if (!saved) throw new Error(`Created expense ${recordId} could not be read before tax-invoice update`);
        const expectedNumber = (input.receivedTaxInvoiceNumber || reference).trim();
        const alreadySaved = saved.supplierInvoices?.some(
          (item) => String(item.documentSerial ?? "").trim() === expectedNumber
        );
        if (!alreadySaved) {
          const supplierInvoice = expectedBody.supplierInvoices[0];
          if (!supplierInvoice) throw new Error("Calculated VAT requires received tax-invoice data");
          const attached = await http.post<{
            data?: { total?: number; vatValue?: number; documentSerial?: string };
          }>(
            endpoints.expenses.attachSupplierInvoice(culture, recordId),
            { ...supplierInvoice, referenceDocumentId: recordId }
          );
          if (
            roundMoney(Number(attached?.data?.total)) !== expectedBody.vatableAmount ||
            roundMoney(Number(attached?.data?.vatValue)) !== expectedBody.vatValue
          ) {
            throw new Error(
              `Received tax-invoice attachment verification failed for expense ${recordId}: ` +
              `expected taxable amount ${expectedBody.vatableAmount} and VAT ${expectedBody.vatValue}, ` +
              `got ${attached?.data?.total} and ${attached?.data?.vatValue}`
            );
          }
        }
      }
      await getAndVerifyExpense(http, culture, recordId, { ...input, reference });
    } catch (verificationError) {
      let cleanupMessage = " The unverified record was deleted.";
      try {
        await rollbackExpenseAndVerify(http, culture, recordId);
      } catch (cleanupError) {
        cleanupMessage = ` Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      throw new Error(
        `${verificationError instanceof Error ? verificationError.message : String(verificationError)}.${cleanupMessage}`
      );
    }
    return result;
  } finally {
    referencesInFlight.delete(reference);
  }
}

const AI_PROVIDER_PROFILES = {
  openai: {
    contactName: "OpenAI OpCo, LLC",
    contactAddress: "1455 3rd Street, San Francisco, California 94158, United States",
    contactTaxId: "0993000528824",
    serviceName: "ChatGPT Plus Subscription",
  },
  anthropic: {
    contactName: "Anthropic, PBC",
    contactAddress: "548 Market Street, PMB 90375, San Francisco, California 94104, United States",
    contactTaxId: "0993000497902",
    serviceName: "Claude Subscription",
  },
} as const;

function resolveAiProviderProfile(input: AiSubscriptionExpenseInput) {
  if (input.provider !== "other") return AI_PROVIDER_PROFILES[input.provider];
  const missing = [
    ["providerName", input.providerName],
    ["providerAddress", input.providerAddress],
    ["providerTaxId", input.providerTaxId],
    ["serviceName", input.serviceName],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `provider=other requires ${missing.join(", ")}; copy the legal supplier details from the invoice and do not infer them from the AI product brand`
    );
  }
  return {
    contactName: input.providerName!.trim(),
    contactAddress: input.providerAddress!.trim(),
    contactTaxId: input.providerTaxId!.trim(),
    serviceName: input.serviceName!.trim(),
  };
}

export function buildAiSubscriptionExpenseInput(
  input: AiSubscriptionExpenseInput
): ExpenseCreateInput {
  input = aiSubscriptionExpenseSchema.parse(input);
  const profile = resolveAiProviderProfile(input);
  if (input.conversionSource === "bot_reference_rate") {
    if (!input.exchangeRate || !input.exchangeRateDate) {
      throw new Error(
        "BOT conversion requires both exchangeRate and exchangeRateDate; use the prior business day when paidOn is not a BOT publication day"
      );
    }
    const converted = multiplyMoney(input.amountUsd, input.exchangeRate);
    if (converted !== roundMoney(input.amountThb)) {
      throw new Error(
        `amountThb does not match amountUsd x exchangeRate: expected ${converted}, got ${input.amountThb}`
      );
    }
  }

  const pp36DueDate = input.pp36DueDate || seventhOfFollowingMonth(input.paidOn);
  const card = input.paymentCardLast4 ? ` by card ending ${input.paymentCardLast4}` : "";
  const conversion = input.conversionSource === "bot_reference_rate"
    ? `BOT USD reference rate ${input.exchangeRate} THB/USD on ${input.exchangeRateDate}`
    : "actual THB amount from the card statement";
  const description =
    `${profile.serviceName}, ${input.subscriptionStart} - ${input.subscriptionEnd}; ` +
    `USD ${input.amountUsd.toFixed(2)}; ${conversion}`;

  return expenseCreateSchema.parse({
    contactName: profile.contactName,
    contactAddress: profile.contactAddress,
    contactTaxId: profile.contactTaxId,
    contactBranch: "00000",
    publishedOn: input.paidOn,
    dueDate: input.paidOn,
    reference: input.receiptNumber,
    isVatInclusive: false,
    items: [{
      description,
      quantity: 1,
      pricePerUnit: input.amountThb,
      // The foreign supplier did not charge Thai VAT. Keep the expense and
      // card payable at the actual THB charge; PP.36 is attached separately.
      vatType: 3,
      expenseDebitCode: input.expenseDebitCode,
      expenseCreditCode: input.expenseCreditCode,
    }],
    remarks:
      `${profile.serviceName}. Base THB ${input.amountThb.toFixed(2)}; ` +
      `PP.36 VAT THB ${multiplyMoney(input.amountThb, 0.07).toFixed(2)}; ` +
      `PP.36 due ${pp36DueDate}. ` +
      (input.conversionSource === "bot_reference_rate"
        ? "Replace the BOT-converted base with the actual card-statement amount when available."
        : "Base uses the actual card-statement amount."),
    internalNotes:
      `Invoice ${input.invoiceNumber}; receipt ${input.receiptNumber}; paid ${input.paidOn}${card}. ` +
      `${conversion}. No withholding tax recorded; foreign seller treated as having no PE in Thailand.`,
  });
}

export function buildPp36SupplierInvoice(
  input: AiSubscriptionExpenseInput,
  recordId: number
) {
  const profile = resolveAiProviderProfile(input);
  return {
    documentDate: `${input.paidOn}T00:00:00`,
    documentSerial: input.invoiceNumber.trim(),
    referenceDocumentType: 13,
    referenceDocumentId: recordId,
    contactBranch: "00000",
    contactName: profile.contactName,
    contactTaxId: profile.contactTaxId,
    // FlowAccount's PP.36 dialog calls this field "มูลค่าที่จ่ายจริง". It is
    // the foreign-service base only; the self-assessed VAT is paid separately.
    total: roundMoney(input.amountThb),
    vatValue: multiplyMoney(input.amountThb, 0.07),
    confirmSave: false,
    taxForm: 3,
  };
}

export async function attachPp36SupplierInvoice(
  http: FlowAccountHttpClient,
  culture: string,
  recordId: number,
  input: AiSubscriptionExpenseInput
) {
  const expected = buildPp36SupplierInvoice(input, recordId);
  const attached = await http.post<{
    data?: { total?: number; vatValue?: number; documentSerial?: string; taxForm?: number };
  }>(endpoints.expenses.attachSupplierInvoice(culture, recordId), expected);
  const saved = attached?.data;
  if (!saved) {
    throw new Error(`PP.36 attachment for expense ${recordId} returned no data`);
  }
  if (
    roundMoney(Number(saved.total)) !== expected.total ||
    roundMoney(Number(saved.vatValue)) !== expected.vatValue ||
    String(saved.documentSerial ?? "").trim() !== expected.documentSerial ||
    (saved.taxForm != null && Number(saved.taxForm) !== 3)
  ) {
    throw new Error(
      `PP.36 attachment verification failed for expense ${recordId}: expected ` +
      `base ${expected.total}, VAT ${expected.vatValue}, invoice "${expected.documentSerial}" and taxForm 3; ` +
      `got base ${saved.total}, VAT ${saved.vatValue}, invoice "${saved.documentSerial ?? ""}" ` +
      `and taxForm ${saved.taxForm ?? "unknown"}`
    );
  }
  return attached;
}

function seventhOfFollowingMonth(paidOn: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paidOn);
  if (!match) throw new Error("paidOn must use yyyy-MM-dd");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("paidOn contains an invalid month");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-07`;
}

export async function resolveExpenseAccounts(
  input: ExpenseCreateInput,
  company: CompanyCacheRecord,
  chartAccounts: ChartAccountService
): Promise<ExpenseCreateInput> {
  await chartAccounts.ensureChartCache(company);
  try {
    return resolveExpenseAccountsFromCache(input, company.companyCode, chartAccounts);
  } catch (firstError) {
    // A missing or mismatched code can mean the 24-hour cache became stale.
    // Refresh atomically once, then fail closed if the authoritative result is
    // still absent or inconsistent.
    await chartAccounts.refreshChartCache(company);
    try {
      return resolveExpenseAccountsFromCache(input, company.companyCode, chartAccounts);
    } catch (secondError) {
      const reason = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(
        `Cannot resolve expense accounts for companyCode=${company.companyCode}: ${reason}`,
        { cause: firstError }
      );
    }
  }
}

export async function createExpenseWithAccountResolution(
  http: FlowAccountHttpClient,
  culture: string,
  input: ExpenseCreateInput,
  company: CompanyCacheRecord,
  chartAccounts: ChartAccountService
) {
  let resolved = await resolveExpenseAccounts(input, company, chartAccounts);
  try {
    return await createExpenseGuarded(http, culture, resolved);
  } catch (error) {
    if (!isFlowAccountAccountMismatch(error)) throw error;
    chartAccounts.invalidateChartCache(company.companyCode);
    await chartAccounts.refreshChartCache(company);
    resolved = resolveExpenseAccountsFromCache(input, company.companyCode, chartAccounts);
    return createExpenseGuarded(http, culture, resolved);
  }
}

function isFlowAccountAccountMismatch(error: unknown): boolean {
  const candidate = error as {
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const status = candidate.response?.status;
  const detail = `${candidate.message ?? ""} ${JSON.stringify(candidate.response?.data ?? "")}`;
  return (
    (status === 400 || status === 409 || status === 422 || /verification/i.test(detail)) &&
    /(account|บัญชี|debit|credit|category|รหัส)/i.test(detail)
  );
}

function resolveExpenseAccountsFromCache(
  input: ExpenseCreateInput,
  companyCode: string,
  chartAccounts: ChartAccountService
): ExpenseCreateInput {
  return {
    ...input,
    items: input.items.map((item, index) => {
      const debit = resolveOneAccount(
        chartAccounts, companyCode, item.expenseDebitCode,
        item.expenseDebitId, item.expenseDebitCategory, `item ${index + 1} debit`
      );
      const credit = resolveOneAccount(
        chartAccounts, companyCode, item.expenseCreditCode,
        item.expenseCreditId, item.expenseCreditCategory, `item ${index + 1} credit`
      );
      return {
        ...item,
        expenseDebitId: debit.accountId,
        expenseDebitCode: debit.accountCode,
        expenseDebitCategory: debit.categoryCode,
        expenseCreditId: credit.accountId,
        expenseCreditCode: credit.accountCode,
        expenseCreditCategory: credit.categoryCode,
      };
    }),
  };
}

function resolveOneAccount(
  chartAccounts: ChartAccountService,
  companyCode: string,
  accountCode: string,
  suppliedId: number | undefined,
  suppliedCategory: number | undefined,
  label: string
): ChartAccount {
  if (suppliedId) chartAccounts.assertAccountBelongsToCompany(companyCode, suppliedId);
  const account = chartAccounts.getAccountByCode(companyCode, accountCode);
  if (!account) throw new Error(`${label} accountCode=${accountCode} was not found`);
  if (!account.isActive) throw new Error(`${label} accountCode=${accountCode} is inactive`);
  if (account.accountType !== "sub_account") {
    throw new Error(`${label} accountCode=${accountCode} is a control account and cannot be posted`);
  }
  if (!account.categoryCode) {
    throw new Error(`${label} accountCode=${accountCode} has no category code`);
  }
  if (suppliedId && suppliedId !== account.accountId) {
    throw new Error(
      `${label} accountCode=${accountCode} resolves to accountId=${account.accountId}, not supplied accountId=${suppliedId}`
    );
  }
  if (suppliedCategory && suppliedCategory !== account.categoryCode) {
    throw new Error(
      `${label} accountCode=${accountCode} resolves to categoryCode=${account.categoryCode}, not supplied categoryCode=${suppliedCategory}`
    );
  }
  return account;
}

async function getAndVerifyExpense(
  http: FlowAccountHttpClient,
  culture: string,
  recordId: number,
  input: ExpenseCreateInput
) {
  const result = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
    endpoints.expenses.get(culture, recordId)
  );
  const expense = result?.data?.list?.[0];
  if (!expense) throw new Error(`Created expense ${recordId} could not be read back`);
  if (String(expense.reference ?? "").trim() !== input.reference.trim()) {
    throw new Error(`Created expense ${recordId} has an incorrect reference`);
  }
  if (Number(expense.expenseCategoryViewType) !== 1) {
    throw new Error(`Created expense ${recordId} is not using accountant-category mode`);
  }
  const savedItems = expense.productItems ?? [];
  if (savedItems.length !== input.items.length) {
    throw new Error(`Created expense ${recordId} has an unexpected number of account items`);
  }
  input.items.forEach((expected, index) => {
    const saved = savedItems[index];
    const isAccountantMode =
      Number(saved?.expenseCategoryId) === 0 &&
      saved?.expenseSystemCode == null &&
      Number(saved?.expenseDebitId) === expected.expenseDebitId &&
      String(saved?.expenseDebitCode ?? "").trim() === expected.expenseDebitCode.trim() &&
      Number(saved?.expenseCreditId) === expected.expenseCreditId &&
      String(saved?.expenseCreditCode ?? "").trim() === expected.expenseCreditCode.trim();
    if (!isAccountantMode) {
      throw new Error(
        `Created expense ${recordId} item ${index + 1} failed accountant-category account-code verification`
      );
    }

    const expectedGross = expected.pricePerUnit * expected.quantity;
    const savedGross = Number(saved?.total);
    if (!Number.isFinite(savedGross) || Math.abs(savedGross - expectedGross) > 0.01) {
      throw new Error(
        `Created expense ${recordId} item ${index + 1} has an incorrect gross total: ` +
        `expected ${expectedGross}, got ${saved?.total}`
      );
    }
    const savedDiscount = Number(saved?.discountPerItem ?? 0);
    if (!Number.isFinite(savedDiscount) || roundMoney(savedDiscount) !== 0) {
      throw new Error(
        `Created expense ${recordId} item ${index + 1} has an incorrect discount: ` +
        `expected 0 because expense discounts are document-level, got ${saved?.discountPerItem}`
      );
    }
  });
  const expectedBody = buildExpenseBody(input);
  const amountChecks: Array<[string, unknown, number]> = [
    ["gross subtotal", expense.subTotal, expectedBody.subTotal],
    ["discount", expense.discount, expectedBody.discount],
    ["total after discount", expense.totalAfterDiscount, expectedBody.totalAfterDiscount],
    ["VAT base", expense.vatableAmount, expectedBody.vatableAmount],
    ["VAT", expense.vatValue, expectedBody.vatValue],
    ["grand total", expense.total, expectedBody.total],
  ];
  for (const [label, actual, expected] of amountChecks) {
    const savedAmount = Number(actual);
    if (!Number.isFinite(savedAmount) || roundMoney(savedAmount) !== expected) {
      throw new Error(
        `Created expense ${recordId} has an incorrect ${label}: expected ${expected}, got ${actual}`
      );
    }
  }
  const savedVatBase = roundMoney(Number(expense.vatableAmount));
  const savedVat = roundMoney(Number(expense.vatValue));
  const savedExempt = roundMoney(Number(expense.exemptAmount ?? 0));
  const savedGrandTotal = roundMoney(Number(expense.total));
  if (sumMoney([savedVatBase, savedVat, savedExempt]) !== savedGrandTotal) {
    throw new Error(
      `Created expense ${recordId} failed the two-decimal checksum: ` +
      `${savedVatBase} + ${savedVat} + ${savedExempt} != ${savedGrandTotal}`
    );
  }
  if (Number(expectedBody.vatValue) > 0) {
    const expectedNumber = (input.receivedTaxInvoiceNumber || input.reference).trim();
    // Expense detail can expose supplierInvoices[].vatValue as 0 even when the
    // authoritative purchase-tax summary contains the correct VAT. Verify the
    // received invoice identity here; do not treat that projection as a VAT
    // amount check or attempt a destructive re-attachment.
    const supplierInvoice = expense.supplierInvoices?.find(
      (item) => String(item.documentSerial ?? "").trim() === expectedNumber
    );
    if (!supplierInvoice) {
      throw new Error(
        `Created expense ${recordId} is missing received tax invoice number "${expectedNumber}"`
      );
    }
    const supplierTaxableAmount = Number(supplierInvoice.total);
    if (
      !Number.isFinite(supplierTaxableAmount) ||
      roundMoney(supplierTaxableAmount) !== expectedBody.vatableAmount
    ) {
      throw new Error(
        `Created expense ${recordId} received tax invoice has an incorrect taxable amount: ` +
        `expected ${expectedBody.vatableAmount}, got ${supplierInvoice.total}`
      );
    }
    if (
      supplierInvoice.taxForm != null &&
      Number(supplierInvoice.taxForm) !== Number(input.receivedTaxForm ?? 1)
    ) {
      throw new Error(
        `Created expense ${recordId} received tax invoice has taxForm=${supplierInvoice.taxForm}, ` +
        `expected ${input.receivedTaxForm ?? 1}`
      );
    }
  }
  return expense;
}

export async function rollbackExpenseAndVerify(
  http: FlowAccountHttpClient,
  culture: string,
  recordId: number
): Promise<void> {
  const deleted = await http.delete<{ status?: boolean; message?: string }>(
    endpoints.expenses.delete(culture, recordId)
  );
  if (deleted?.status === false) {
    throw new Error(deleted.message || "FlowAccount rejected the delete request");
  }
  try {
    const readBack = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
      endpoints.expenses.get(culture, recordId)
    );
    const remaining = readBack?.data?.list?.[0];
    if (remaining && remaining.isDelete !== true) {
      throw new Error(
        `FlowAccount returned success for deletion but expense ${recordId} ` +
        `still exists with status=${remaining.status ?? "unknown"}`
      );
    }
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) return;
    throw error;
  }
}

export function registerExpenseTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager,
  chartAccounts: ChartAccountService
) {
  const c = () => tokenManager.getCulture();

  // --- List expense categories from existing expenses ---
  server.tool(
    "list_expense_categories",
    "List available expense categories by extracting unique categories from existing expense documents. Returns category IDs needed for create_expense.",
    {},
    async () => {
      // Fetch a batch of expenses to extract unique categories
      const result = await http.get<{
        data?: {
          list?: Array<{
            productItems?: Array<Record<string, unknown>>;
          }>;
        };
      }>(endpoints.expenses.list(c()), { currentPage: 1, pageSize: 100, range: 0 });

      const categories = new Map<string, Record<string, unknown>>();
      const list = result?.data?.list ?? [];
      for (const expense of list) {
        for (const pi of expense.productItems ?? []) {
          const debitId = Number(pi.expenseDebitId);
          const creditId = Number(pi.expenseCreditId);
          const debitCode = String(pi.expenseDebitCode ?? "").trim();
          const creditCode = String(pi.expenseCreditCode ?? "").trim();
          if (
            debitId > 0 &&
            creditId > 0 &&
            debitCode &&
            creditCode
          ) {
            const key = [
              debitId,
              debitCode,
              creditId,
              creditCode,
              Number(pi.expenseDebitCategory ?? 5),
              Number(pi.expenseCreditCategory ?? 2),
            ].join(":");
            if (categories.has(key)) continue;
            categories.set(key, {
              expenseCategoryId: Number(pi.expenseCategoryId ?? 0),
              nameLocal: pi.expenseCategoryNameLocal,
              nameForeign: pi.expenseCategoryNameForeign,
              expenseSystemCode: pi.expenseSystemCode,
              expenseDebitId: debitId,
              expenseDebitCode: debitCode,
              expenseDebitCategory: pi.expenseDebitCategory,
              expenseDebitNameLocal: pi.expenseDebitNameLocal,
              expenseCreditId: creditId,
              expenseCreditCode: creditCode,
              expenseCreditCategory: pi.expenseCreditCategory,
              expenseCreditNameLocal: pi.expenseCreditNameLocal,
            });
          }
        }
      }

      const cats = Array.from(categories.values());
      if (cats.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No complete accountant-mode debit/credit account pairs were found in the sampled expenses. Create an accountant-mode expense in the FlowAccount UI first, then this tool can discover its account pair.",
          }],
        };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(cats, null, 2) }] };
    }
  );

  // --- List expenses ---
  server.tool(
    "list_expenses",
    "List expense documents with optional date range",
    {
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
      startDate: z.string().optional().describe("Filter start date (yyyy-MM-dd)"),
      endDate: z.string().optional().describe("Filter end date (yyyy-MM-dd)"),
      status: z.number().optional().describe("Filter by status: 0=all, 1=awaiting, 3=approved, 4=pendingPayment, 5=paid, 7=void"),
    },
    async ({ page, limit, startDate, endDate, status }) => {
      const params = buildDocListParams({ page, limit, startDate, endDate, filterStatus: status });
      const result = await http.get(endpoints.expenses.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: DOC_FIELDS, page, limit, statusMap: EXPENSE_STATUS }) }] };
    }
  );

  // --- Get single expense ---
  server.tool(
    "get_expense",
    "Get a single expense document by ID",
    { id: z.number().describe("Expense document ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.expenses.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Create expense ---
  server.tool(
    "create_expense",
    "Create an expense after resolving every debit/credit account code against the active company's chart cache. Account IDs and categories are optional and are rejected if they mismatch. Exact duplicate references are blocked.",
    expenseCreateFields,
    async (input) => {
      const company = await getExpenseCompany(tokenManager);
      const result = await createExpenseWithAccountResolution(
        http, c(), input, company, chartAccounts
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_ai_subscription_expense",
    "Create a foreign AI subscription expense for OpenAI, Anthropic, z.ai, Qwen, or another provider. The supplier expense is no-VAT and equals the actual THB charge; 7% self-assessed VAT is attached separately as PP.36. Use provider=other with the exact legal supplier details from the invoice. Defaults to account 53113 and credit account 21379.01.",
    aiSubscriptionExpenseFields,
    async (rawInput) => {
      const { filePath, ...subscription } = aiSubscriptionExpenseSchema.parse(rawInput);
      const expenseInput = buildAiSubscriptionExpenseInput(subscription);
      const company = await getExpenseCompany(tokenManager);
      const created = await createExpenseWithAccountResolution(
        http, c(), expenseInput, company, chartAccounts
      );
      const recordId = created.data?.recordId;
      if (!recordId) throw new Error("AI subscription expense creation returned no recordId");
      let pp36: unknown;
      try {
        pp36 = await attachPp36SupplierInvoice(http, c(), recordId, subscription);
      } catch (error) {
        let cleanupMessage = " The base-only expense was deleted.";
        try {
          await rollbackExpenseAndVerify(http, c(), recordId);
        } catch (cleanupError) {
          cleanupMessage = ` Cleanup also failed; expense ${recordId} may remain: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
        }
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}.${cleanupMessage}`
        );
      }
      const expenseTotal = roundMoney(subscription.amountThb);
      const pp36VatAmount = multiplyMoney(subscription.amountThb, 0.07);

      let attachment: unknown;
      let attachmentError: string | undefined;
      if (filePath) {
        try {
          attachment = await uploadDocumentAttachment(http, c(), "expenses", recordId, filePath);
        } catch (error) {
          // The expense is already approved at this point. Preserve it and
          // report an attachment warning instead of claiming a rollback.
          attachmentError = error instanceof Error ? error.message : String(error);
        }
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({
        created: true,
        verified: true,
        recordId,
        documentSerial: created.data?.documentSerial,
        reference: subscription.receiptNumber,
        provider: subscription.provider,
        expenseVatRate: 0,
        expenseTotal,
        cardOrSupplierPayable: expenseTotal,
        pp36TaxableAmount: expenseTotal,
        pp36VatAmount,
        taxForm: 3,
        pp36Attached: true,
        pp36,
        attachmentUploaded: Boolean(filePath && !attachmentError),
        attachment,
        attachmentError,
      }, null, 2) }] };
    }
  );

  server.tool(
    "create_expense_with_attachment",
    "Atomically create, read-back verify, and attach a local file to an expense. Exact duplicate references are blocked. If verification or upload fails, only the expense created by this call is rolled back.",
    {
      ...expenseCreateFields,
      filePath: z.string().min(1).describe("Absolute path of the PDF or other supported attachment"),
    },
    async ({ filePath, ...input }) => {
      let recordId: number | undefined;
      try {
        const company = await getExpenseCompany(tokenManager);
        const created = await createExpenseWithAccountResolution(
          http, c(), input, company, chartAccounts
        );
        const resolved = await resolveExpenseAccounts(input, company, chartAccounts);
        recordId = created.data?.recordId;
        if (!recordId) throw new Error("Expense creation returned no recordId");
        const verifiedBeforeUpload = await getAndVerifyExpense(http, c(), recordId, resolved);
        const attachment = await uploadDocumentAttachment(http, c(), "expenses", recordId, filePath);
        const verified = await getAndVerifyExpense(http, c(), recordId, resolved);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          created: true,
          verified: true,
          attachmentUploaded: true,
          rolledBack: false,
          recordId,
          documentSerial: verified.documentSerial ?? verifiedBeforeUpload.documentSerial,
          reference: verified.reference,
          attachment,
        }, null, 2) }] };
      } catch (error) {
        let rollbackError: unknown;
        if (recordId) {
          try {
            await rollbackExpenseAndVerify(http, c(), recordId);
          } catch (rollbackFailure) {
            rollbackError = rollbackFailure;
          }
        }
        const reason = error instanceof Error ? error.message : String(error);
        const rollback = recordId
          ? rollbackError
            ? ` Rollback of record ${recordId} also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            : ` Created record ${recordId} was rolled back.`
          : " No document was created.";
        throw new Error(`create_expense_with_attachment failed: ${reason}.${rollback}`);
      }
    }
  );

  // --- Update expense metadata ---
  server.tool(
    "update_expense",
    "Update an existing expense document (only when status is awaiting)",
    {
      id: z.number().describe("Expense document ID to update"),
      reference: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Source document number stored in FlowAccount field เลขที่อ้างอิง (reference)"
        ),
      remarks: z.string().optional().describe("Remarks/notes shown on document"),
      internalNotes: z.string().optional().describe("Internal notes"),
    },
    async ({ id, ...data }) => {
      const current = await http.get<{
        data?: { list?: Array<Record<string, unknown>> };
      }>(endpoints.expenses.get(c(), id));
      const existing = current?.data?.list?.[0];
      if (!existing) {
        throw new Error(`Expense ${id} not found`);
      }
      const result = await http.put(endpoints.expenses.update(c(), id), {
        ...existing,
        ...data,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Delete expense ---
  server.tool(
    "delete_expense",
    "Delete an expense document (only if status is awaiting)",
    { id: z.number().describe("Expense document ID to delete") },
    async ({ id }) => {
      const result = await http.delete(endpoints.expenses.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Record payment ---
  server.tool(
    "record_expense_payment",
    "Record a payment for an expense document",
    {
      id: z.number().describe("Expense document ID"),
      paymentMethod: z.number().describe("1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard"),
      paymentDate: z.string().describe("Payment date (yyyy-MM-dd)"),
      paymentAmount: z.number().describe("Payment amount"),
      bankAccountId: z.number().optional().describe("Bank account ID (for transfer/cheque)"),
      remarks: z.string().optional().describe("Payment remarks"),
    },
    async ({ id, ...paymentData }) => {
      const result = await http.post(endpoints.expenses.recordPayment(c(), id), paymentData);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}

async function getExpenseCompany(tokenManager: TokenManager): Promise<CompanyCacheRecord> {
  await tokenManager.getAuthHeaders(BASE.OPENAPI);
  const companyCode = tokenManager.getCompanySupportCode();
  if (!companyCode) throw new Error("Cannot determine the active FlowAccount company before creating an expense");
  return {
    companyCode,
    nameLocal: companyCode,
    lastVerifiedAt: new Date().toISOString(),
  };
}

/**
 * Expected fields that our code ACTUALLY reads/writes.
 * Only these are checked — extra fields from API are ignored (tolerance policy).
 */

// --- Response envelope (all list endpoints) ---
export const ENVELOPE_REQUIRED = ["data", "status"] as const;
export const ENVELOPE_DATA_REQUIRED = ["list", "total", "currentPage"] as const;

// --- Document list item (fields from DOC_FIELDS that code reads) ---
export const DOC_LIST_CRITICAL = ["recordId", "documentSerial", "contactName", "status"] as const;
export const DOC_LIST_OPTIONAL = ["publishedOn", "dueDate", "subTotal", "total", "totalAfterDiscount"] as const;

// --- Document detail (fields code reads in get/update handlers) ---
export const DOC_DETAIL_CRITICAL = ["recordId", "documentSerial", "contactName", "status", "productItems"] as const;
export const DOC_DETAIL_OPTIONAL = ["statusString"] as const;

// --- Product item inside document detail ---
export const PRODUCT_ITEM_CRITICAL = ["name", "quantity", "pricePerUnit"] as const;

// --- Expense-specific fields inside productItems (used by list_expense_categories) ---
export const EXPENSE_CATEGORY_CRITICAL = [
  "expenseCategoryId",
  "expenseSystemCode",
  "expenseDebitId",
  "expenseDebitCode",
  "expenseCreditId",
  "expenseCreditCode",
] as const;

// --- Contact list item (API uses "id"/"name", NOT "contactId"/"contactName") ---
export const CONTACT_CRITICAL = ["id", "contactGroup", "contactType"] as const;
export const CONTACT_OPTIONAL = ["name", "code", "taxId", "email", "mobile"] as const;

// --- Product list item (API uses "id", NOT "productId") ---
export const PRODUCT_CRITICAL = ["name", "type"] as const;
export const PRODUCT_OPTIONAL = ["sellPrice", "buyPrice", "unitName"] as const;

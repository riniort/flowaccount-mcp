---
name: expense
description: Record an expense (ค่าใช้จ่าย) by asking for vendor and item details
allowed-tools:
  - mcp
  - Read
  - AskUserQuestion
argument-hint: "[vendor name or expense description]"
---

Record an expense (ค่าใช้จ่าย) on FlowAccount by gathering information from the user.

## Workflow

1. Check if `.claude/flowaccount.local.md` exists in the project for company defaults

2. If the vendor is any foreign AI provider (including OpenAI, Anthropic, z.ai,
   or Qwen) and the Thai VAT-registered buyer must
   self-assess VAT, gather the receipt number, invoice number, subscription
   period, USD amount, THB card-statement amount (preferred) or BOT rate/date,
   card last four digits, and confirmation that the seller has no Thai PE. Use
   `create_ai_subscription_expense`; it keeps the supplier expense at VAT 0
   and attaches the 7% PP.36 record separately. Stop after showing its verified
   result. For providers other than the built-in OpenAI and Anthropic profiles,
   copy the legal supplier name, address, tax/registration ID, and service name
   exactly from the invoice; never infer the legal entity from the product brand.

3. If the user provided a vendor name or description in the arguments, use that. Otherwise, ask:
   - Vendor/supplier name (ชื่อผู้จำหน่าย)
   - Vendor tax ID (เลขผู้เสียภาษี) — optional
   - Vendor branch number (สำนักงานใหญ่/สาขา) — default `00000`; pad numeric branches to five digits, for example branch `10` becomes `00010`; treat `HQ`, `Main Branch`, and `Headquarter` as `00000`

4. Ask for expense items. For each item:
   - Item name/description (รายการ)
   - Quantity (จำนวน)
   - Price per unit (ราคาต่อหน่วย)
   - Ask if there are more items
   - Debit and credit account codes. Use `search_chart_of_accounts` when the
     user gives an account name instead of a code. Never guess an account ID.

5. Ask for:
   - Document date (วันที่ — default today)
   - Due date (วันครบกำหนด) — optional
   - Any remarks (หมายเหตุ)

6. Show a summary and ask for confirmation

7. Use `create_expense` tool to create the document

8. Ask if the user wants to record payment now:
   - If yes, ask for payment method (1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard)
   - For transfer/cheque, get bank account using `get_bank_accounts` first
   - Use `record_expense_payment` to record payment

9. Show the result with document number

## Notes

- Expenses are buy-side documents — contact is the supplier/vendor
- Use VAT type 1 by default, `isVatInclusive: true`
- Pass `expenseDebitCode` and `expenseCreditCode`; account IDs and categories
  are resolved and verified automatically for the active company
- Communicate in Thai when the user writes in Thai

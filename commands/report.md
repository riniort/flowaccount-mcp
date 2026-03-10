---
name: report
description: Generate a summary report of sales, expenses, or outstanding payments from FlowAccount
allowed-tools:
  - mcp
  - Read
  - AskUserQuestion
argument-hint: "[report type: sales/expenses/outstanding or date range]"
---

Generate a summary report from FlowAccount data by querying relevant documents.

## Workflow

1. Ask the user what kind of report they want (if not specified in arguments):
   - Sales summary (สรุปยอดขาย) — tax invoices, receipts, cash invoices
   - Expense summary (สรุปค่าใช้จ่าย) — expenses
   - Outstanding payments (ยอดค้างชำระ) — unpaid invoices
   - All documents (ภาพรวม) — everything in a period

2. Ask for date range:
   - Start date (วันเริ่มต้น)
   - End date (วันสิ้นสุด)
   - Or use shortcuts like "this month", "last month", "this year"

3. Fetch data using the appropriate list tools with date filters:
   - `list_tax_invoices` for tax invoices
   - `list_receipts` for receipts
   - `list_cash_invoices` for cash invoices
   - `list_expenses` for expenses
   - `list_billing_notes` for billing notes

4. Compile and present a summary table showing:
   - Document count per type
   - Total amount per type
   - Grand total
   - For outstanding report: list unpaid documents with amounts

5. Present the report in a clear table format

## Notes

- Use pagination (offset/limit) to fetch all documents in the period
- Calculate totals from the fetched data
- Format currency as Thai Baht (฿)
- Communicate in Thai when the user writes in Thai
- Keep the report concise but informative

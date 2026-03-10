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

2. If the user provided a vendor name or description in the arguments, use that. Otherwise, ask:
   - Vendor/supplier name (ชื่อผู้จำหน่าย)
   - Vendor tax ID (เลขผู้เสียภาษี) — optional

3. Ask for expense items. For each item:
   - Item name/description (รายการ)
   - Quantity (จำนวน)
   - Price per unit (ราคาต่อหน่วย)
   - Ask if there are more items

4. Ask for:
   - Document date (วันที่ — default today)
   - Due date (วันครบกำหนด) — optional
   - Any remarks (หมายเหตุ)

5. Show a summary and ask for confirmation

6. Use `create_expense` tool to create the document

7. Ask if the user wants to record payment now:
   - If yes, ask for payment method (1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard)
   - For transfer/cheque, get bank account using `get_bank_accounts` first
   - Use `record_expense_payment` to record payment

8. Show the result with document number

## Notes

- Expenses are buy-side documents — contact is the supplier/vendor
- Use VAT type 1 by default, `isVatInclusive: true`
- Communicate in Thai when the user writes in Thai

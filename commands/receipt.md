---
name: receipt
description: Create a receipt (ใบเสร็จรับเงิน) by asking for customer and item details
allowed-tools:
  - mcp
  - Read
  - AskUserQuestion
argument-hint: "[customer name or description]"
---

Create a receipt (ใบเสร็จรับเงิน) on FlowAccount by gathering information from the user.

## Workflow

1. Check if `.claude/flowaccount.local.md` exists in the project for company defaults

2. If the user provided a customer name in the arguments, use that. Otherwise, ask:
   - Customer name (ชื่อลูกค้า)
   - Customer tax ID (เลขผู้เสียภาษี) — optional

3. Ask for line items. For each item:
   - Item name/description (รายการ)
   - Quantity (จำนวน)
   - Price per unit (ราคาต่อหน่วย)
   - Ask if there are more items

4. Ask for:
   - Document date (วันที่ — default today)
   - Any remarks (หมายเหตุ)

5. Show a summary and ask for confirmation

6. Use `create_receipt` tool to create the document

7. Ask if the user wants to record payment now:
   - If yes, ask for payment method (1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard)
   - Use `record_receipt_payment` to record payment

8. Show the result with document number

## Notes

- Receipts are payment confirmations — consider asking about recording payment immediately
- Use VAT type 1 by default, `isVatInclusive: true`
- Communicate in Thai when the user writes in Thai

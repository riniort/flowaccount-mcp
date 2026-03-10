---
name: invoice
description: Create a tax invoice (ใบกำกับภาษี) by asking for customer and item details
allowed-tools:
  - mcp
  - Read
  - AskUserQuestion
argument-hint: "[customer name or description of what to invoice]"
---

Create a tax invoice (ใบกำกับภาษี) on FlowAccount by gathering information from the user.

## Workflow

1. Check if `.claude/flowaccount.local.md` exists in the project for company defaults (VAT type, credit days, payment method)

2. If the user provided a customer name or description in the arguments, use that as starting context. Otherwise, ask:
   - Customer name (ชื่อลูกค้า)
   - Customer tax ID (เลขผู้เสียภาษี) — optional

3. Ask for line items. For each item ask:
   - Item name/description (รายการ)
   - Quantity (จำนวน)
   - Price per unit (ราคาต่อหน่วย)
   - Ask if there are more items

4. Ask for:
   - Document date (วันที่ — default today)
   - Credit days (default 30)
   - Any remarks (หมายเหตุ)

5. Show a summary of the invoice to the user and ask for confirmation before creating

6. Use `create_tax_invoice` tool to create the document

7. Show the result with document number

## Notes

- Use VAT type 1 (VAT 7%) by default unless user specifies otherwise or company defaults say otherwise
- Set `isVatInclusive: true` by default (ราคารวม VAT)
- All dates in yyyy-MM-dd format
- Communicate in Thai when the user writes in Thai

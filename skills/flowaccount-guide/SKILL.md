---
name: flowaccount-api-guide
description: >
  This skill should be used when the user asks about "FlowAccount API",
  "FlowAccount tools", "how to create invoice", "how to create receipt",
  "how to record payment", "document types in FlowAccount",
  "วิธีสร้างใบแจ้งหนี้", "วิธีสร้างใบเสร็จ", "วิธีบันทึกชำระเงิน",
  "ประเภทเอกสาร FlowAccount", or needs guidance on using FlowAccount MCP tools
  for Thai accounting workflows.
---

# FlowAccount API Guide

## Overview

FlowAccount is a Thai cloud accounting platform. This plugin provides 53 MCP tools
for managing the full accounting workflow: contacts, products, documents, expenses, and payments.

## Document Types

FlowAccount supports these document types (sell-side):

| Type | Thai Name | Tool Prefix | Use Case |
|------|-----------|-------------|----------|
| Quotation | ใบเสนอราคา | `*_quotation` | Price proposal to customer |
| Tax Invoice | ใบกำกับภาษี | `*_tax_invoice` | VAT-registered sales |
| Receipt | ใบเสร็จรับเงิน | `*_receipt` | Payment confirmation |
| Billing Note | ใบวางบิล | `*_billing_note` | Payment request |
| Cash Invoice | บิลเงินสด | `*_cash_invoice` | Cash sales |

Buy-side:

| Type | Thai Name | Tool Prefix |
|------|-----------|-------------|
| Purchase Order | ใบสั่งซื้อ | `*_purchase_order` |
| Expense | ค่าใช้จ่าย | `*_expense` |

## Common Workflows

### Creating a Sales Document

1. Look up or create the contact using `list_contacts` or `create_contact`
2. Look up products using `list_products` (optional — can use inline items)
3. Create the document (e.g., `create_tax_invoice`) with contact info and line items
4. Record payment using `record_tax_invoice_payment` or the generic `record_payment`

### Payment Methods

All payment recording tools accept a `paymentMethod` number:

| Value | Method |
|-------|--------|
| 1 | Cash (เงินสด) |
| 3 | Cheque (เช็ค) |
| 5 | Bank Transfer (โอนเงิน) |
| 7 | Credit Card (บัตรเครดิต) |

For transfer/cheque payments, include `bankAccountId`. Retrieve available bank accounts using `get_bank_accounts`.

### VAT Types

All line items accept a `vatType` number:

| Value | Type |
|-------|------|
| 1 | VAT 7% (ภาษีมูลค่าเพิ่ม) |
| 2 | VAT Exempt (ยกเว้นภาษี) |
| 3 | No VAT (ไม่มีภาษี) |

### Contact Types

| Value | Type |
|-------|------|
| 1 | Customer (ลูกค้า) |
| 2 | Supplier (ผู้จำหน่าย) |
| 3 | Both (ทั้งลูกค้าและผู้จำหน่าย) |

## Available Tools Summary

### Entity Management
- **Contacts**: `list_contacts`, `get_contact`, `create_contact`, `update_contact`, `delete_contact`
- **Products**: `list_products`, `get_product`, `create_product`, `update_product`, `delete_product`
- **Business**: `get_business_info`, `get_bank_accounts`

### Sales Documents (each has: list, get, create, update, delete)
- Quotations — plus `change_quotation_status`
- Tax Invoices — plus `record_tax_invoice_payment`
- Receipts — plus `record_receipt_payment`
- Billing Notes — plus `record_billing_note_payment`
- Cash Invoices — plus `record_cash_invoice_payment`

### Buy Documents
- Purchase Orders: `list_purchase_orders`, `get_purchase_order`, `create_purchase_order`, `update_purchase_order`, `delete_purchase_order`
- Expenses: `list_expenses`, `get_expense`, `create_expense`, `delete_expense`, `record_expense_payment`

### Generic Payment
- `record_payment` — works across document types: `tax-invoices`, `receipts`, `cash-invoices`, `expenses`

## Line Item Structure

Every document creation requires an `items` array:

```json
{
  "name": "ค่าบริการออกแบบ",
  "description": "ออกแบบโลโก้",
  "quantity": 1,
  "unitName": "งาน",
  "pricePerUnit": 15000,
  "discount": 0,
  "vatType": 1
}
```

## Date Format

All date fields use `yyyy-MM-dd` format (e.g., `2026-03-10`).

## Settings

Check `.claude/flowaccount.local.md` in the project root for company-specific defaults (VAT settings, default credit days, default payment method, etc.).

## Additional Resources

### Reference Files

For detailed API field mappings and advanced workflows, consult:
- **`references/document-fields.md`** — Complete field reference for all document types
- **`references/settings-template.md`** — Company defaults configuration template

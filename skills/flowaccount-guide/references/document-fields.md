# FlowAccount Document Fields Reference

## Common Fields (All Document Types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| contactName | string | Yes | Customer/supplier name |
| contactTaxId | string | No | Tax ID (เลขประจำตัวผู้เสียภาษี) |
| contactAddress | string | No | Address |
| publishedOn | string | Yes | Document date (yyyy-MM-dd) |
| items | array | Yes | Line items (min 1) |
| isVatInclusive | boolean | No | Prices include VAT? (default: true) |
| remarks | string | No | Remarks shown on document |

## Quotation-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| contactEmail | string | Customer email |
| creditDays | number | Credit days (default: 30) |
| dueDate | string | Due date (yyyy-MM-dd) |
| discountPercentage | number | Overall discount % |
| internalNotes | string | Internal notes (not shown to customer) |
| salesName | string | Salesperson name |
| projectName | string | Project name |

## Tax Invoice-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| contactBranch | string | Branch (สำนักงานใหญ่ or branch number) |
| creditDays | number | Credit days (default: 30) |
| dueDate | string | Due date (yyyy-MM-dd) |
| internalNotes | string | Internal notes |

## Billing Note-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| dueDate | string | Due date (yyyy-MM-dd) |

## Purchase Order-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| dueDate | string | Due date (yyyy-MM-dd) |

## Expense-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| dueDate | string | Due date (yyyy-MM-dd) |
| internalNotes | string | Internal notes |

## Quotation Status Values

Use with `change_quotation_status`:
- `awaiting` — รอดำเนินการ
- `approved` — อนุมัติ
- `approvedandprocessed` — อนุมัติและดำเนินการ
- `rejected` — ปฏิเสธ
- `voided` — ยกเลิก

## Product Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Product name |
| type | number | No | 1=Service, 3=NonInventory, 5=Inventory |
| code | string | No | Product code/SKU |
| description | string | No | Description |
| sellPrice | number | No | Selling price |
| buyPrice | number | No | Buying price |
| unitName | string | No | Unit name (piece, hour, etc.) |
| barcode | string | No | Barcode |
| vatType | number | No | 1=Vat, 2=VatExempt, 3=NoVat |

## Contact Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| contactName | string | Yes | Contact name |
| contactType | number | No | 1=Customer, 2=Supplier, 3=Both (default: 3) |
| contactGroup | number | No | 1=Individual, 3=Business (default: 1) |
| contactAddress | string | No | Address |
| contactTaxId | string | No | Tax ID |
| contactBranch | string | No | Branch name/number |
| contactEmail | string | No | Email |
| contactPhoneNumber | string | No | Phone number |
| contactNote | string | No | Notes |

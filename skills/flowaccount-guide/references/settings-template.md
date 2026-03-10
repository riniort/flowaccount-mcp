# FlowAccount Plugin Settings

Create `.claude/flowaccount.local.md` in your project root to configure company defaults.

## Template

Copy the content below into `.claude/flowaccount.local.md`:

```markdown
---
defaultVatType: 1          # 1=VAT 7%, 2=VAT Exempt, 3=No VAT
defaultCreditDays: 30      # Default credit days for invoices
defaultPaymentMethod: 5    # 1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard
isVatInclusive: true       # Prices include VAT by default
companyBranch: "สำนักงานใหญ่"  # Default branch name
---

## Company Defaults

- Company Name: บริษัท ตัวอย่าง จำกัด
- Default salesperson: -
- Default project: -

## Notes

Add any company-specific notes here for Claude to reference when creating documents.
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| defaultVatType | number | 1 | Default VAT type for line items |
| defaultCreditDays | number | 30 | Default credit days |
| defaultPaymentMethod | number | 5 | Default payment method |
| isVatInclusive | boolean | true | Prices include VAT |
| companyBranch | string | สำนักงานใหญ่ | Default branch |

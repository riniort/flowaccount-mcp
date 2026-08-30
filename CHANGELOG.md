# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-08-30

### Added

- Foreign AI subscription support is no longer limited to OpenAI and
  Anthropic. `provider=other` supports z.ai, Qwen, and other providers using
  exact legal supplier details copied from their invoices.
- Custom providers require legal name, address, tax/registration ID, and
  service description, preventing the MCP from guessing an invoicing entity
  from a product brand.
- Offline tests cover a custom Qwen-style subscription and rejection of an
  incomplete custom-provider profile.

## [1.2.1] - 2026-08-30

### Fixed

- Foreign AI subscriptions now create a VAT-0 supplier expense whose total and
  card payable equal the actual THB charge, then attach 7% self-assessed VAT as
  a separate PP.36 record. This prevents the credit-card balance from being
  overstated and defers the input-tax workflow to the PP.36 remittance receipt.
- PP.36 attachment responses are verified and a newly created base expense is
  rolled back if the required tax record cannot be attached safely.
- Zero-value `amountThb` inputs are rejected.

### Tests

- Added offline coverage for base-only AI expenses, separate PP.36 payloads,
  mismatched attachment responses, positive THB validation, and verified rollback.

## [1.2.0] - 2026-08-30

### Added

- `create_ai_subscription_expense` for OpenAI and Anthropic receipts with
  provider profiles, PP.36, account-code defaults, BOT/card-statement currency
  provenance, no-PE confirmation, and optional receipt upload.
- Offline tests for OpenAI/Anthropic subscription mapping, prior-business-day
  BOT conversions, PP.36 VAT, and card-statement amounts.

### Fixed

- Received tax-invoice `total` now contains the taxable base rather than the
  expense grand total, preventing an overstated “มูลค่าที่จ่ายจริง” in the
  FlowAccount PP.36 UI.
- Post-create verification now checks the received taxable amount and tax form.
- Rollback messages now verify that FlowAccount actually removed the record
  instead of reporting a successful delete when an approved expense remains.

## [1.1.0] - 2026-08-21

### Added

- Per-company SQLite chart-of-accounts cache stored in the OS application-data directory.
- Atomic full sync from FlowAccount's official Chart of Accounts API with a 24-hour TTL.
- MCP tools for account lookup, search, refresh, and cache status.
- Expense account-code resolution with cross-company protection and one refresh retry.

## [1.0.0] - 2026-08-21

### Added

- Initial public release of the FlowAccount MCP server.
- Tools for seven document types, contacts, products, payments, attachments,
  company information, expense categories, and document duplication.
- Supplier `contactBranch` support for expenses, including head-office aliases
  and zero-padded five-digit branch normalization.
- Guidance when FlowAccount credentials are missing.
- Offline tests for expense discounts, VAT, rounding, validation, and safe
  expense duplication.

### Changed

- Expense discounts now use one absolute document-level amount. Line items stay
  gross, and VAT is calculated after the overall discount.
- Monetary calculations now use decimal half-up rounding and persist totals to
  two decimal places.
- Expense duplication now copies the authoritative document discount and stops
  before creation if recalculation would change the source totals.

### Fixed

- Prevented an expense discount from being multiplied by item quantity.
- Corrected VAT and grand-total calculations for discounted, VAT-inclusive,
  VAT-exclusive, mixed-VAT, and fully discounted expenses.
- Added stricter validation for VAT type, quantity, price, and discount precision.
- Added post-create checks for item discounts, document totals, VAT totals, and
  two-decimal checksums.

### Known Issues

- FlowAccount's expense-detail UI and `supplierInvoices[].vatValue` projection
  may show received tax-invoice VAT as `0.00` even when the purchase-tax summary
  contains the correct value. The purchase-tax summary and expense-level totals
  should be treated as authoritative.

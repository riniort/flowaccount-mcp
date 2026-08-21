# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

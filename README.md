# FlowAccount MCP Server

MCP (Model Context Protocol) server for [FlowAccount](https://flowaccount.com) — a Thai cloud accounting platform. This server enables AI assistants like Claude to manage your FlowAccount data through natural language.

> [!IMPORTANT]
> This is an independent, unofficial integration and is not affiliated with or
> endorsed by FlowAccount. It uses endpoints observed from the FlowAccount web
> application, which may change without notice.

See [CHANGELOG.md](CHANGELOG.md) for release history and notable changes.

## Features

### Documents (7 types)
- **Quotations** (ใบเสนอราคา) — create, list, get, update, delete, change status
- **Tax Invoices** (ใบกำกับภาษี) — create, list, get, update, delete, record payment
- **Receipts** (ใบเสร็จรับเงิน) — create, list, get, update, delete, record payment
- **Billing Notes** (ใบวางบิล) — create, list, get, update, delete, record payment
- **Cash Invoices** (บิลเงินสด) — create, list, get, update, delete, record payment
- **Purchase Orders** (ใบสั่งซื้อ) — create, list, get, update, delete
- **Expenses** (ค่าใช้จ่าย) — create, list, get, update, delete, record payment

### Contacts & Products
- **Contacts** — create, list, search, get, update, delete (customers & suppliers)
- **Products** — create, list, search, get, update, delete (services & inventory)

### Payments
- **Unified payment recording** — record payment on any document type (cash, cheque, transfer, credit card)

### File Attachments
- **Upload attachments** to any document type (PDF, images, Office docs, ZIP/RAR)

### Business Info
- Company profile and bank accounts

## Setup

### Prerequisites
- Node.js 18+
- A FlowAccount account (paid subscription)

### Install

```bash
git clone https://github.com/riniort/flowaccount-mcp.git
cd flowaccount-mcp
npm install
npm run build
```

### Authentication

On first run, the server opens a Playwright browser to FlowAccount's login page. Sign in with your credentials — the server captures and stores auth tokens automatically.

Tokens are saved to `~/.flowaccount-mcp/tokens.json` and reused across sessions. When expired, the server re-authenticates automatically.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `FLOWACCOUNT_CULTURE` | `th` | Language/locale (`th`, `en`) |
| `FLOWACCOUNT_HEADLESS` | `false` | Run auth browser headless |
| `FLOWACCOUNT_BROWSER_TIMEOUT` | `120000` | Auth browser timeout (ms) |
| `FLOWACCOUNT_TOKEN_PATH` | `~/.flowaccount-mcp/tokens.json` | Token storage path |
| `FLOWACCOUNT_CREDENTIAL_TARGET` | `FlowAccountMCP` on Windows | Generic Windows Credential target used for automatic re-login; set empty to disable |
| `FLOWACCOUNT_COMPANY_SUPPORT_CODE` | Previous token company | Company support code such as `N1234567` for automatic company selection |
| `FLOWACCOUNT_IDLE_RECHECK_MS` | `900000` | Idle period before the next request rechecks authentication |
| `FLOWACCOUNT_CHART_CACHE_PATH` | OS application-data directory | SQLite chart-of-accounts cache path |
| `FLOWACCOUNT_CHART_CACHE_TTL_MS` | `86400000` | Chart cache TTL in milliseconds (24 hours) |

On Windows, if the configured Generic Credential is missing, the MCP asks
whether to open Credential Manager. Choosing **Yes** opens it and the MCP waits
for the credential to be added before continuing authentication.

Authentication is lazy: starting or discovering the MCP does not open a browser
or read credentials. Clients should call `get_active_company` before the first
FlowAccount operation in a chat and announce the company code and full name.

The MCP also publishes a prompt named `flowaccountmcp`. MCP clients that map
prompts to slash commands can invoke it as `/flowaccountmcp`, optionally with
a FlowAccount request.

The `flowaccountchange` prompt is available as `/flowaccountchange` in
clients that map MCP prompts to slash commands. Without an argument it shows a
Markdown table of company codes and full names. With a company code it directs
the client to call `change_active_company`, which re-authenticates, selects,
and verifies the requested company.

For `create_expense`, the source document number is required in `reference`.
The server sends it explicitly to FlowAccount's **เลขที่อ้างอิง** field and
verifies that the create response contains the same value. Expense list output
also includes `reference` to support duplicate checks.

Expense account IDs and categories are resolved from the official FlowAccount
Chart of Accounts API using the required debit and credit account codes. The
SQLite cache is isolated by active company and stored outside the repository:

- Windows: `%LOCALAPPDATA%\FlowAccountMCP\data\cache.sqlite`
- macOS: `~/Library/Application Support/FlowAccountMCP/cache.sqlite`
- Linux: `~/.local/share/flowaccount-mcp/cache.sqlite`

Call `search_chart_of_accounts` to find a code. `create_expense` requires
`expenseDebitCode` and `expenseCreditCode`; the corresponding IDs and category
codes are optional and, when supplied, must match the active company's cache.
The server refreshes stale data once and never guesses an account ID.

Expense creation tools also expose `contactBranch` for the supplier branch
number. It defaults to `00000` (head office), zero-pads numeric branches to
five digits (`10` or `สาขา 10` becomes `00010`), and is sent to the received
supplier tax-invoice record. Head-office labels such as `สำนักงานใหญ่`,
`Head Office`, `Main Branch`, `HQ`, and `Headquarter` are normalized to
`00000`.

Expense discounts use one absolute `discount` amount at document level. Item
discounts are intentionally not accepted: keeping item totals gross prevents a
discount from being multiplied by quantity and makes the VAT base auditable as
`subTotal - discount`.

### Claude Desktop Integration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flowaccount": {
      "command": "node",
      "args": ["/path/to/FlowAccountMCP/dist/index.js"]
    }
  }
}
```

## Available MCP Tools

| Tool | Description |
|---|---|
| `get_active_company` | Authenticate on demand and identify the active company |
| `change_active_company` | Change and verify the active company |
| `get_account_by_code` | Resolve an account code for the active company |
| `search_chart_of_accounts` | Search account code or Thai/English name |
| `refresh_chart_of_accounts` | Force an atomic full cache refresh |
| `get_chart_cache_status` | Inspect cache freshness and sync errors |
| `list_contacts` | List/search contacts |
| `get_contact` | Get contact by ID |
| `create_contact` | Create customer/supplier |
| `update_contact` | Update contact |
| `delete_contact` | Delete contact |
| `list_products` | List/search products |
| `get_product` | Get product by ID |
| `create_product` | Create product/service |
| `update_product` | Update product |
| `delete_product` | Delete product |
| `list_quotations` | List quotations |
| `get_quotation` | Get quotation by ID |
| `create_quotation` | Create quotation |
| `update_quotation` | Update quotation |
| `delete_quotation` | Delete quotation |
| `change_quotation_status` | Change status (approved, rejected, voided) |
| `list_tax_invoices` | List tax invoices |
| `get_tax_invoice` | Get tax invoice by ID |
| `create_tax_invoice` | Create tax invoice |
| `update_tax_invoice` | Update tax invoice |
| `delete_tax_invoice` | Delete tax invoice |
| `record_tax_invoice_payment` | Record payment |
| `list_receipts` | List receipts |
| `get_receipt` | Get receipt by ID |
| `create_receipt` | Create receipt |
| `update_receipt` | Update receipt |
| `delete_receipt` | Delete receipt |
| `record_receipt_payment` | Record payment |
| `list_billing_notes` | List billing notes |
| `get_billing_note` | Get billing note by ID |
| `create_billing_note` | Create billing note |
| `update_billing_note` | Update billing note |
| `delete_billing_note` | Delete billing note |
| `record_billing_note_payment` | Record payment |
| `list_cash_invoices` | List cash invoices |
| `get_cash_invoice` | Get cash invoice by ID |
| `create_cash_invoice` | Create cash invoice |
| `update_cash_invoice` | Update cash invoice |
| `delete_cash_invoice` | Delete cash invoice |
| `record_cash_invoice_payment` | Record payment |
| `list_purchase_orders` | List purchase orders |
| `get_purchase_order` | Get purchase order by ID |
| `create_purchase_order` | Create purchase order |
| `update_purchase_order` | Update purchase order |
| `delete_purchase_order` | Delete purchase order |
| `list_expenses` | List expenses |
| `list_expense_categories` | Discover accountant-mode debit/credit account pairs |
| `get_expense` | Get expense by ID |
| `create_expense` | Resolve account codes, then create and read-back verify an expense |
| `create_ai_subscription_expense` | Create a foreign AI subscription at VAT 0 and attach PP.36 separately |
| `create_expense_with_attachment` | Create, verify, and attach a file atomically |
| `update_expense` | Update an awaiting expense |
| `delete_expense` | Delete expense |
| `record_expense_payment` | Record payment |
| `record_payment` | Record payment on any document type |
| `upload_attachment` | Upload file attachment to any document |
| `duplicate_document` | Duplicate supported documents; expenses require a new unique reference |
| `get_business_info` | Get company info |
| `get_bank_accounts` | List bank accounts |

### Foreign AI subscriptions (OpenAI, Anthropic, z.ai, Qwen, and others)

Use `create_ai_subscription_expense` for any foreign AI SaaS receipt when the
Thai VAT-registered buyer must self-assess VAT on form PP.36. The tool:

- uses the provider receipt number as FlowAccount `reference`;
- uses the provider invoice number as the received tax-invoice number;
- defaults to debit account `53113` and credit account `21379.01`;
- records the supplier expense as no VAT so its total and card payable equal
  `amountThb`, then attaches a separate PP.36 record whose taxable base is
  `amountThb` and whose self-assessed VAT is 7%;
- prefers the actual THB card-statement amount, but accepts a BOT reference
  rate with its publication date when the statement is unavailable;
- supports an optional receipt attachment without deleting an already-created
  expense if only the upload fails; and
- requires explicit confirmation that the seller has no Thai permanent
  establishment before recording zero withholding tax.

OpenAI and Anthropic have built-in supplier profiles. For z.ai, Qwen, or any
other provider, set `provider` to `other` and supply `providerName`,
`providerAddress`, `providerTaxId`, and `serviceName` exactly from the invoice.
Product branding alone is not enough to identify the invoicing legal entity,
so the MCP rejects incomplete custom-provider profiles instead of guessing.

When the payment date is a weekend or another non-publication day, obtain the
BOT rate for the prior business day and pass that date in `exchangeRateDate`.
The tool verifies that `amountUsd * exchangeRate`, rounded half-up to two
decimals, equals `amountThb`.

## PP.36 accounting boundary

### The supplier expense correctly shows VAT `0.00`

The foreign supplier does not charge Thai VAT on these qualifying B2B receipts. The
supplier expense therefore remains VAT 0 and its payable equals the actual THB
card charge. The tool creates the 7% self-assessment independently as a PP.36
received-tax record.

- Reconcile the expense total—not expense plus PP.36 VAT—to the card statement.
- Use the PP.36 record and the Revenue Department receipt after remittance for
  the input-tax workflow; do not expect input VAT on the supplier expense.
- The tool verifies the separately attached PP.36 base, VAT, invoice number,
  and tax-form response before reporting success.

## Project Structure

```
src/
  index.ts                  # Entry point (stdio transport)
  server.ts                 # MCP server creation & tool registration
  api/
    endpoints.ts            # API endpoint definitions
    http-client.ts          # HTTP client (JSON + multipart file upload)
  auth/
    token-manager.ts        # Token lifecycle management
    token-store.ts          # Persistent token storage
    browser-auth.ts         # Playwright-based browser authentication
    windows-credential.ts   # Optional Windows Credential Manager integration
  tools/
    contacts.ts             # Contact CRUD tools
    products.ts             # Product CRUD tools
    expenses.ts             # Expense tools
    duplicate.ts            # Cross-document duplication
    payments.ts             # Unified payment tool
    attachments.ts          # File attachment upload tool
    business-info.ts        # Company info tools
    documents/
      quotations.ts         # Quotation tools
      tax-invoices.ts       # Tax invoice tools
      receipts.ts           # Receipt tools
      billing-notes.ts      # Billing note tools
      cash-invoices.ts      # Cash invoice tools
      purchase-orders.ts    # Purchase order tools
  utils/
    config.ts               # Environment configuration
    logger.ts               # Logging utility
    list-formatter.ts       # Compact list response formatter
```

## Development

```bash
npm run dev    # Run with tsx (auto-reload)
npm run build  # Compile TypeScript
npm test       # Build and run the offline calculation tests
npm start      # Run compiled version
```

## Security and privacy

- Authentication tokens are stored locally at `~/.flowaccount-mcp/tokens.json`
  by default and are excluded from Git.
- Never commit token files, `.env` files, exported accounting data, attachments,
  passwords, or Windows Credential Manager exports.
- Review the active company returned by `get_active_company` before any write.
- Write and delete tools change real accounting data. Test them in a non-production
  company first.

Please report security issues privately to the repository maintainer rather than
opening a public issue containing credentials or accounting data.

## License and attribution

Released under the [MIT License](LICENSE).

Originally based on [todsawat/FlowAccountMCP](https://github.com/todsawat/FlowAccountMCP).
Maintained and extended by [riniort](https://github.com/riniort) and contributors.

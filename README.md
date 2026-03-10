# FlowAccount MCP Server

MCP (Model Context Protocol) server for [FlowAccount](https://flowaccount.com) — a Thai cloud accounting platform. This server enables AI assistants like Claude to manage your FlowAccount data through natural language.

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
git clone <repo-url>
cd FlowAccountMCP
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
| `get_expense` | Get expense by ID |
| `create_expense` | Create expense |
| `delete_expense` | Delete expense |
| `record_expense_payment` | Record payment |
| `record_payment` | Record payment on any document type |
| `upload_attachment` | Upload file attachment to any document |
| `get_business_info` | Get company info |
| `get_bank_accounts` | List bank accounts |

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
  tools/
    contacts.ts             # Contact CRUD tools
    products.ts             # Product CRUD tools
    expenses.ts             # Expense tools
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
npm start      # Run compiled version
```

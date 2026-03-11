import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { TokenManager } from "./auth/token-manager.js";
import { FlowAccountHttpClient } from "./api/http-client.js";

// Tool registrations
import { registerContactTools } from "./tools/contacts.js";
import { registerProductTools } from "./tools/products.js";
import { registerExpenseTools } from "./tools/expenses.js";
import { registerPaymentTools } from "./tools/payments.js";
import { registerBusinessInfoTools } from "./tools/business-info.js";
import { registerQuotationTools } from "./tools/documents/quotations.js";
import { registerTaxInvoiceTools } from "./tools/documents/tax-invoices.js";
import { registerReceiptTools } from "./tools/documents/receipts.js";
import { registerBillingNoteTools } from "./tools/documents/billing-notes.js";
import { registerCashInvoiceTools } from "./tools/documents/cash-invoices.js";
import { registerPurchaseOrderTools } from "./tools/documents/purchase-orders.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerDuplicateTools } from "./tools/duplicate.js";

export async function createServer(): Promise<McpServer> {
  const config = loadConfig();
  logger.info(`FlowAccount MCP Server starting (culture: ${config.culture})`);

  // Initialize authentication
  const tokenManager = new TokenManager(config);
  await tokenManager.initialize();

  // Create HTTP client
  const http = new FlowAccountHttpClient(tokenManager);

  // Create MCP server
  const server = new McpServer({
    name: "flowaccount",
    version: "1.0.0",
  });

  // Register all tools
  registerContactTools(server, http, tokenManager);
  registerProductTools(server, http, tokenManager);
  registerExpenseTools(server, http, tokenManager);
  registerPaymentTools(server, http, tokenManager);
  registerBusinessInfoTools(server, http, tokenManager);
  registerQuotationTools(server, http, tokenManager);
  registerTaxInvoiceTools(server, http, tokenManager);
  registerReceiptTools(server, http, tokenManager);
  registerBillingNoteTools(server, http, tokenManager);
  registerCashInvoiceTools(server, http, tokenManager);
  registerPurchaseOrderTools(server, http, tokenManager);
  registerAttachmentTools(server, http, tokenManager);
  registerDuplicateTools(server, http, tokenManager);

  logger.info("All tools registered successfully");

  return server;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";

export function registerPaymentTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "record_payment",
    "Record a payment on any document type (tax invoice, receipt, cash invoice, expense)",
    {
      documentType: z
        .enum(["tax-invoices", "receipts", "cash-invoices", "expenses"])
        .describe("Document type to record payment for"),
      documentId: z.number().describe("Document record ID"),
      paymentMethod: z.number().describe("1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard"),
      paymentDate: z.string().describe("Payment date (yyyy-MM-dd)"),
      paymentAmount: z.number().describe("Payment amount"),
      bankAccountId: z.number().optional().describe("Bank account ID (for transfer/cheque)"),
      remarks: z.string().optional().describe("Payment remarks"),
    },
    async ({ documentType, documentId, ...paymentData }) => {
      const epMap = {
        "tax-invoices": endpoints.taxInvoices.recordPayment,
        receipts: endpoints.receipts.recordPayment,
        "cash-invoices": endpoints.cashInvoices.recordPayment,
        expenses: endpoints.expenses.recordPayment,
      } as const;
      const epFn = epMap[documentType as keyof typeof epMap];
      const result = await http.post(epFn(c(), documentId), paymentData);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}

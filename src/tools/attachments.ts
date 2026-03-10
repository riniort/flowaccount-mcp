import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";

const DOCUMENT_TYPES = [
  "quotations",
  "tax-invoices",
  "receipts",
  "billing-notes",
  "cash-invoices",
  "purchase-orders",
  "expenses",
] as const;

type DocType = (typeof DOCUMENT_TYPES)[number];

export function registerAttachmentTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  const getUploadEndpoint = (docType: DocType, id: number) => {
    const map = {
      quotations: endpoints.quotations.uploadAttachment,
      "tax-invoices": endpoints.taxInvoices.uploadAttachment,
      receipts: endpoints.receipts.uploadAttachment,
      "billing-notes": endpoints.billingNotes.uploadAttachment,
      "cash-invoices": endpoints.cashInvoices.uploadAttachment,
      "purchase-orders": endpoints.purchaseOrders.uploadAttachment,
      expenses: endpoints.expenses.uploadAttachment,
    } as const;
    return map[docType](c(), id);
  };

  server.tool(
    "upload_attachment",
    "Upload a file attachment to any document type (quotation, tax invoice, receipt, billing note, cash invoice, purchase order, expense). The file must exist on the local filesystem.",
    {
      documentType: z
        .enum(DOCUMENT_TYPES)
        .describe(
          "Document type: quotations, tax-invoices, receipts, billing-notes, cash-invoices, purchase-orders, expenses"
        ),
      documentId: z.number().describe("Document record ID"),
      filePath: z
        .string()
        .describe(
          "Absolute path to the file on the local filesystem. Supported formats: PNG, JPEG, PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, ZIP, RAR"
        ),
    },
    async ({ documentType, documentId, filePath }) => {
      if (!existsSync(filePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: File not found: ${filePath}`,
            },
          ],
          isError: true,
        };
      }

      const ep = getUploadEndpoint(documentType as DocType, documentId);
      const result = await http.postFile(ep, filePath);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );
}

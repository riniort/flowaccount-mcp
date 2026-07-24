import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { TokenManager } from "./auth/token-manager.js";
import { FlowAccountHttpClient } from "./api/http-client.js";
import { endpoints } from "./api/endpoints.js";
import { z } from "zod";

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

  // Authentication is intentionally lazy. Merely starting/discovering this MCP
  // must never open a browser, read credentials, or refresh a token.
  const tokenManager = new TokenManager(config);

  // Create HTTP client
  const http = new FlowAccountHttpClient(tokenManager);

  type CompanyChoice = {
    code: string;
    name: string;
  };

  let companyName = "ยังไม่ได้เชื่อมต่อ";
  let companyChoices: CompanyChoice[] = [];
  let activeCompany = `ยังไม่ได้เชื่อมต่อ — จะตรวจสอบเมื่อเรียกใช้ FlowAccount ครั้งแรก`;

  const refreshCompanyContext = async () => {
    const businessInfo = (await http.get(endpoints.businessInfo.me())) as {
      data?: {
        company?: { nameLocal?: string; nameForeign?: string };
        user?: {
          companyList?: Array<{
            supportCode?: string;
            company_NameLocal?: string;
            company_NameForeign?: string;
          }>;
        };
      };
    };
    companyName =
      businessInfo.data?.company?.nameLocal ||
      businessInfo.data?.company?.nameForeign ||
      companyName;
    companyChoices = (businessInfo.data?.user?.companyList || [])
      .filter((item) => /^N\d+$/.test(item.supportCode || ""))
      .map((item) => ({
        code: item.supportCode!,
        name:
          item.company_NameLocal ||
          item.company_NameForeign ||
          "ไม่ระบุชื่อบริษัท",
      }));
    activeCompany = `${tokenManager.getCompanySupportCode() || "Unknown code"} — ${companyName}`;
    return activeCompany;
  };

  logger.info("Authentication deferred until the first FlowAccount tool call");

  // Create MCP server
  const server = new McpServer(
    {
      name: "flowaccount",
      version: "1.0.0",
    },
    {
      instructions:
        "FLOWACCOUNT AUTHENTICATION IS LAZY. Do not authenticate merely because the MCP starts or its tools are discovered. " +
        "At the beginning of every new chat/session, before performing any " +
        "FlowAccount work, call get_active_company and explicitly tell the user which company is active. " +
        "Include both the company code and the full company name returned by that tool. " +
        "Do this once per new chat/session and repeat only if the " +
        "active company changes or the user asks. When creating an expense, " +
        "always put the source document number in the required reference field.",
    }
  );

  server.prompt(
    "flowaccountmcp",
    "Activate FlowAccount MCP for the current chat and optionally provide a task",
    {
      request: z
        .string()
        .optional()
        .describe("Optional FlowAccount task to perform after activation"),
    },
    ({ request }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Activate FlowAccount MCP. Call get_active_company first, then tell me the active company code and full company name. " +
              "Use the FlowAccount MCP tools for subsequent FlowAccount work. " +
              (request
                ? `Then perform this request: ${request}`
                : "Then ask what FlowAccount task I want to perform."),
          },
        },
      ],
    })
  );

  server.prompt(
    "flowaccountchange",
    "List FlowAccount companies or change the active company by company code",
    {
      company_code: z
        .string()
        .optional()
        .describe("Optional FlowAccount company support code, for example N1234567"),
    },
    ({ company_code }) => {
      const requestedCode = company_code?.trim().toUpperCase();
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: requestedCode
                ? `Call change_active_company with companyCode "${requestedCode}". It will authenticate on demand, verify the company, and return the active company code and full name.`
                : "Call get_active_company now. Show its companies result as a table and ask me to choose a company code. Tell me I can run /flowaccountchange with the chosen code.",
            },
          },
        ],
      };
    }
  );

  server.tool(
    "get_active_company",
    "Authenticate only when called, then return the active FlowAccount company code, full name, and available companies.",
    {},
    async () => {
      await refreshCompanyContext();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          activeCompany,
          companies: companyChoices,
        }, null, 2) }],
      };
    }
  );

  server.tool(
    "change_active_company",
    "Change the active FlowAccount company. Re-authenticates in the background and verifies the selected company.",
    {
      companyCode: z
        .string()
        .regex(/^N\d+$/)
        .describe("FlowAccount company support code, for example N1234567"),
    },
    async ({ companyCode }) => {
      const requestedCode = companyCode.toUpperCase();
      await refreshCompanyContext();
      const knownCompany = companyChoices.find(
        (company) => company.code === requestedCode
      );
      if (!knownCompany) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `ไม่พบ company code ${requestedCode}\n\n` +
                formatCompanyTable(companyChoices),
            },
          ],
        };
      }

      await tokenManager.switchCompany(requestedCode);
      const verified = (await http.get(endpoints.businessInfo.me())) as {
        data?: { company?: { nameLocal?: string; nameForeign?: string } };
      };
      const verifiedCode = tokenManager.getCompanySupportCode();
      const verifiedName =
        verified.data?.company?.nameLocal ||
        verified.data?.company?.nameForeign ||
        knownCompany.name;
      if (verifiedCode !== requestedCode) {
        throw new Error(
          `Company switch verification failed: expected ${requestedCode}, got ${verifiedCode}`
        );
      }
      activeCompany = `${verifiedCode} — ${verifiedName}`;
      await refreshCompanyContext();
      return {
        content: [
          {
            type: "text" as const,
            text: `เปลี่ยน active company สำเร็จ: ${activeCompany}`,
          },
        ],
      };
    }
  );

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

function formatCompanyTable(
  companies: Array<{ code: string; name: string }>
): string {
  if (companies.length === 0) {
    return "ไม่พบรายชื่อบริษัทในบัญชี FlowAccount";
  }
  const rows = companies.map(
    (company) => `| ${company.code} | ${company.name.replace(/\|/g, "\\|")} |`
  );
  return [
    "| Company code | ชื่อเต็ม |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting FlowAccount MCP Server...");

  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("FlowAccount MCP Server connected and ready");
}

main().catch((err) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});

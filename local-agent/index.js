import { loadConfig } from "./config.js";
import { runAgent } from "./agent.js";
import { logger } from "./log.js";

const action = process.argv[2];
const config = await loadConfig();

if (!action) {
  logger.info("Usage: node index.js <email|instagram|draft|status>");
  logger.info("Examples:");
  logger.info("  node index.js draft --subject \"New chapter preview\"");
  logger.info("  node index.js email --subject \"New chapter preview\"");
  logger.info("  node index.js instagram --text \"Draft copy\"");
  logger.info("  node index.js status");
  process.exit(1);
}

try {
  await runAgent(action, config);
} catch (error) {
  logger.error("Agent failed:", error.message);
  if (error.detail) {
    logger.error(error.detail);
  }
  process.exit(1);
}

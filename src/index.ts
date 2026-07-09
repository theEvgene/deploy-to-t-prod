#!/usr/bin/env node
import { runCli } from "./cli.js";
import { logger } from "./logger.js";
import { isUserAbortError } from "./utils/abort.js";

try {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
} catch (error) {
  if (isUserAbortError(error)) {
    process.exitCode = 130;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

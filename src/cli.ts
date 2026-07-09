import { RunArtifacts, summarizeJob, summarizePipeline } from "./artifacts/runArtifacts.js";
import { runConfigMenu } from "./config/configMenu.js";
import { loadReleaseConfig } from "./config/configStore.js";
import { logger } from "./logger.js";
import { askReleaseConfirmation } from "./release/confirmation.js";
import { collectReleaseChanges, createConfiguredGitLabClient } from "./release/changeCollector.js";
import { waitForPipelineCompletion } from "./release/pipelineCompletion.js";
import { createTagAndStartManualJob } from "./release/pipelineStarter.js";
import { formatReleasePreview, printChanges } from "./release/preview.js";
import { parseReleaseVersion, toGitLabReleaseTagName, type ReleaseVersion } from "./tag.js";
import { isUserAbortError, throwIfAborted } from "./utils/abort.js";

type ParsedArgs = {
  tagName?: string;
  config: boolean;
  dryRun: boolean;
  help: boolean;
};

export async function runCli(argv: string[]): Promise<number> {
  const abortController = setupCtrlCHandling();
  const { signal } = abortController;

  const args = parseArgs(argv);
  throwIfAborted(signal);

  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.config) {
    return runConfigCommand();
  }

  if (!args.tagName) {
    return runChangesCommand(args, signal);
  }

  const releaseVersion = parseReleaseVersion(args.tagName);

  return runReleasePreviewCommand(releaseVersion, args, signal);
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    config: false,
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      result.help = true;
      continue;
    }

    if (arg === "-config" || arg === "--config") {
      result.config = true;
      continue;
    }

    if (arg === "--dry-run" || arg === "-dry") {
      result.dryRun = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (result.tagName) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    result.tagName = arg;
  }

  return result;
}

async function runConfigCommand(): Promise<number> {
  return runConfigMenu();
}

async function runChangesCommand(args: ParsedArgs, signal: AbortSignal): Promise<number> {
  logger.step("Starting changes preview");
  logger.info(`Dry-run: ${args.dryRun ? "yes" : "no"}`);

  const releaseConfig = await loadReleaseConfig();
  const client = await createConfiguredGitLabClient(releaseConfig, signal);
  const changes = await collectReleaseChanges(client, releaseConfig);
  printChanges(changes);

  logger.step("No tag will be created in this mode.");
  return 0;
}

async function runReleasePreviewCommand(
  releaseVersion: ReleaseVersion,
  args: ParsedArgs,
  signal: AbortSignal,
): Promise<number> {
  const releaseConfig = await loadReleaseConfig();
  const tagName = toGitLabReleaseTagName(releaseVersion, releaseConfig);

  logger.step("Starting release preview");
  logger.info(`Release version: ${releaseVersion}`);
  logger.info(`GitLab tag: ${tagName}`);
  logger.info(`Dry-run: ${args.dryRun ? "yes" : "no"}`);

  const client = await createConfiguredGitLabClient(releaseConfig, signal);

  logger.step("Checking that tag does not already exist");
  const existingTag = await client.getTag(tagName);
  if (existingTag) {
    throw new Error(`Tag ${tagName} already exists at ${existingTag.commit.short_id}.`);
  }

  const changes = await collectReleaseChanges(client, releaseConfig);
  logger.step("Printing preview");
  const previewText = formatReleasePreview(tagName, changes, releaseConfig);
  console.log(previewText);

  if (args.dryRun) {
    logger.step("Dry-run finished. No tag was created.");
    return 0;
  }

  const confirmed = await askReleaseConfirmation(signal);
  if (!confirmed) {
    logger.step("Release stopped before any changes.");
    return 0;
  }

  const artifacts = await RunArtifacts.create({
    tagName,
    releaseConfig,
    changes,
    previewText,
  });
  const detachLogger = logger.addSink((entry) => artifacts.log(entry));
  logger.info(`Run artifacts: ${artifacts.directory}`);

  try {
    await artifacts.trace("confirmation_accepted");
    const result = await createTagAndStartManualJob(client, tagName, changes, releaseConfig, signal, artifacts);
    logger.step("Tag was created and manual job was started.");
    logger.info(`Pipeline: ${result.pipeline.web_url}`);
    logger.info(`Manual job: ${result.playedJob.web_url}`);
    const completedPipeline = await waitForPipelineCompletion(client, result.pipeline.id, releaseConfig, signal, artifacts);
    await artifacts.finish("success", {
      pipeline: summarizePipeline(completedPipeline),
      manualJob: summarizeJob(result.playedJob),
    });
    return 0;
  } catch (error) {
    const status = isUserAbortError(error) ? "cancelled" : "failed";
    await artifacts.recordError(error);
    await artifacts.finish(status);
    throw error;
  } finally {
    detachLogger();
    await artifacts.close();
  }
}

function printHelp(): void {
  console.log(`Usage:
  release-tag
  release-tag <version> [--dry-run|-dry]
  release-tag -config
  release-tag --config

Examples:
  release-tag
  release-tag 14.1.13
  release-tag 14.1.13 --dry-run
  release-tag -config`);
}

function setupCtrlCHandling(): AbortController {
  const abortController = new AbortController();

  process.once("SIGINT", () => {
    console.log("");
    logger.warn("Execution stopped by user.");
    abortController.abort();
  });

  return abortController;
}

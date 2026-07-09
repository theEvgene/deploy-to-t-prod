import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";

import { getConfigDirectoryPath } from "../config/configStore.js";
import type { ReleaseConfig } from "../constants.js";
import type { GitLabCommit, GitLabJob, GitLabPipeline, GitLabTag } from "../gitlab/types.js";
import type { LogEntry } from "../logger.js";
import type { ReleaseChanges } from "../release/changeCollector.js";
import type { GitLabReleaseTagName } from "../tag.js";

type RunStatus = "running" | "success" | "failed" | "cancelled";

type RunArtifactsInput = {
  tagName: GitLabReleaseTagName;
  releaseConfig: ReleaseConfig;
  changes: ReleaseChanges;
  previewText: string;
};

type RunMetadata = {
  schemaVersion: 1;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  tagName: string;
  projectPath: string;
  branch: string;
  manualJobName: string;
  timeouts: {
    manualJobTimeoutMinutes: number;
    pipelineTimeoutMinutes: number;
    pollIntervalSeconds: number;
  };
  targetCommit: CommitSummary;
  previousTag: TagSummary;
  artifactsDirectory: string;
};

type CommitSummary = {
  id: string;
  shortId: string;
  title: string;
  webUrl?: string;
};

type TagSummary = {
  name: string;
  target: string;
  createdAt: string | null;
  commit: CommitSummary;
};

const maxStoredRuns = 10;

export class RunArtifacts {
  readonly directory: string;

  private readonly metadataPath: string;
  private readonly errorPath: string;
  private readonly traceStream: WriteStream;
  private readonly consoleStream: WriteStream;
  private metadata: RunMetadata;

  private constructor(directory: string, metadata: RunMetadata) {
    this.directory = directory;
    this.metadata = metadata;
    this.metadataPath = join(directory, "run.json");
    this.errorPath = join(directory, "error.json");
    this.traceStream = createWriteStream(join(directory, "trace.jsonl"), { flags: "a", encoding: "utf8" });
    this.consoleStream = createWriteStream(join(directory, "console.log"), { flags: "a", encoding: "utf8" });
    this.traceStream.on("error", (error) => {
      console.warn(`[warn] Failed to write run artifact trace: ${error.message}`);
    });
    this.consoleStream.on("error", (error) => {
      console.warn(`[warn] Failed to write run artifact console log: ${error.message}`);
    });
  }

  static async create(input: RunArtifactsInput): Promise<RunArtifacts> {
    const startedAt = new Date().toISOString();
    const runsDirectory = getRunsDirectoryPath();
    const directory = join(runsDirectory, `${formatTimestampForPath(startedAt)}_${sanitizePathPart(input.tagName)}`);
    await mkdir(directory, { recursive: true });

    const metadata: RunMetadata = {
      schemaVersion: 1,
      status: "running",
      startedAt,
      tagName: input.tagName,
      projectPath: input.releaseConfig.projectPath,
      branch: input.releaseConfig.branch,
      manualJobName: input.releaseConfig.manualJobName,
      timeouts: {
        manualJobTimeoutMinutes: input.releaseConfig.manualJobTimeoutMinutes,
        pipelineTimeoutMinutes: input.releaseConfig.pipelineTimeoutMinutes,
        pollIntervalSeconds: input.releaseConfig.pollIntervalSeconds,
      },
      targetCommit: summarizeCommit(input.changes.latestCommit),
      previousTag: summarizeTag(input.changes.previousTag),
      artifactsDirectory: directory,
    };

    const artifacts = new RunArtifacts(directory, metadata);
    await writeFile(join(directory, "preview.txt"), `${input.previewText.trim()}\n`, "utf8");
    await artifacts.writeMetadata();
    await artifacts.trace("run_started", {
      tagName: input.tagName,
      targetCommit: metadata.targetCommit,
      previousTag: metadata.previousTag,
    });
    await enforceRunsRetention(runsDirectory);

    return artifacts;
  }

  log(entry: LogEntry): void {
    if (this.consoleStream.destroyed) {
      return;
    }

    this.consoleStream.write(`${entry.time} [${entry.level}] ${entry.message}\n`);
  }

  async trace(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    try {
      await writeLine(this.traceStream, JSON.stringify({
        time: new Date().toISOString(),
        event,
        ...payload,
      }));
    } catch (error) {
      console.warn(`[warn] Failed to write run artifact trace: ${errorMessage(error)}`);
    }
  }

  async recordError(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const serializedError = serializeError(error);
    try {
      await writeFile(this.errorPath, `${JSON.stringify({
        time: new Date().toISOString(),
        error: serializedError,
        context,
      }, null, 2)}\n`, "utf8");
    } catch (writeError) {
      console.warn(`[warn] Failed to write run artifact error file: ${errorMessage(writeError)}`);
    }
    await this.trace("run_error", {
      error: serializedError,
      context,
    });
  }

  async finish(status: Exclude<RunStatus, "running">, payload: Record<string, unknown> = {}): Promise<void> {
    this.metadata = {
      ...this.metadata,
      status,
      finishedAt: new Date().toISOString(),
    };
    await this.trace("run_finished", {
      status,
      ...payload,
    });
    try {
      await this.writeMetadata();
    } catch (error) {
      console.warn(`[warn] Failed to write run artifact metadata: ${errorMessage(error)}`);
    }
  }

  async close(): Promise<void> {
    try {
      await closeStream(this.traceStream);
      await closeStream(this.consoleStream);
    } catch (error) {
      console.warn(`[warn] Failed to close run artifact streams: ${errorMessage(error)}`);
    }
  }

  private async writeMetadata(): Promise<void> {
    await writeFile(this.metadataPath, `${JSON.stringify(this.metadata, null, 2)}\n`, "utf8");
  }
}

export function getRunsDirectoryPath(): string {
  return join(getConfigDirectoryPath(), "runs");
}

export async function enforceRunsRetention(runsDirectory = getRunsDirectoryPath()): Promise<void> {
  await mkdir(runsDirectory, { recursive: true });

  const entries = await readdir(runsDirectory, { withFileTypes: true });
  const runDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const staleDirectories = runDirectories.slice(0, Math.max(0, runDirectories.length - maxStoredRuns));
  for (const directoryName of staleDirectories) {
    await rm(join(runsDirectory, directoryName), { recursive: true, force: true });
  }
}

export function summarizePipeline(pipeline: GitLabPipeline): Record<string, unknown> {
  return {
    id: pipeline.id,
    iid: pipeline.iid,
    ref: pipeline.ref,
    sha: pipeline.sha,
    status: pipeline.status,
    webUrl: pipeline.web_url,
    createdAt: pipeline.created_at,
    startedAt: pipeline.started_at,
    finishedAt: pipeline.finished_at,
    yamlErrors: pipeline.yaml_errors,
  };
}

export function summarizeJob(job: GitLabJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    stage: job.stage,
    status: job.status,
    ref: job.ref,
    webUrl: job.web_url,
    allowFailure: job.allow_failure,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    failureReason: job.failure_reason,
  };
}

function summarizeTag(tag: GitLabTag): TagSummary {
  return {
    name: tag.name,
    target: tag.target,
    createdAt: tag.created_at,
    commit: summarizeCommit(tag.commit),
  };
}

function summarizeCommit(commit: GitLabCommit): CommitSummary {
  return {
    id: commit.id,
    shortId: commit.short_id,
    title: commit.title,
    webUrl: commit.web_url,
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      name: "NonError",
      message: String(error),
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function formatTimestampForPath(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeLine(stream: WriteStream, line: string): Promise<void> {
  if (stream.destroyed) {
    return;
  }

  if (stream.write(`${line}\n`)) {
    return;
  }

  await Promise.race([
    once(stream, "drain"),
    once(stream, "error").then(() => undefined),
  ]);
}

async function closeStream(stream: WriteStream): Promise<void> {
  if (stream.closed || stream.destroyed) {
    return;
  }

  stream.end();
  await once(stream, "finish");
}

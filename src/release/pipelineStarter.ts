import type { ReleaseConfig } from "../constants.js";
import { GitLabClient } from "../gitlab/GitLabClient.js";
import type { GitLabJob, GitLabPipeline, GitLabPipelineStatus } from "../gitlab/types.js";
import { logger } from "../logger.js";
import type { GitLabReleaseTagName } from "../tag.js";
import { createDeadlineMs, done, pending, pollUntil } from "../utils/poller.js";
import type { ReleaseChanges } from "./changeCollector.js";

type StartReleaseResult = {
  pipeline: GitLabPipeline;
  manualJob: GitLabJob;
  playedJob: GitLabJob;
};

const terminalPipelineStatuses = new Set<GitLabPipelineStatus>([
  "success",
  "failed",
  "canceled",
  "skipped",
]);

export async function createTagAndStartManualJob(
  client: GitLabClient,
  tagName: GitLabReleaseTagName,
  changes: ReleaseChanges,
  releaseConfig: ReleaseConfig,
  signal: AbortSignal,
): Promise<StartReleaseResult> {
  logger.step("Creating annotated tag");
  const createdTag = await client.createAnnotatedTag(tagName, changes.latestCommit.id, changes.tagMessage);
  logger.info(`Created tag ${createdTag.name} at ${createdTag.commit.short_id}`);

  const manualJobDeadlineMs = createDeadlineMs(releaseConfig.manualJobTimeoutMinutes);

  logger.step("Searching pipeline for created tag");
  const pipeline = await waitForPipeline(client, tagName, changes.latestCommit.id, manualJobDeadlineMs, releaseConfig, signal);
  logger.info(`Found pipeline #${pipeline.id}: ${pipeline.web_url}`);

  logger.step(`Polling jobs for manual job ${releaseConfig.manualJobName}`);
  const manualJob = await waitForManualJob(client, pipeline.id, manualJobDeadlineMs, releaseConfig, signal);
  logger.info(`Found manual job #${manualJob.id}: ${manualJob.web_url}`);

  logger.step("Starting manual job");
  const playedJob = await client.playJob(manualJob.id);
  logger.info(`Manual job started: ${playedJob.web_url}`);

  return {
    pipeline,
    manualJob,
    playedJob,
  };
}

async function waitForPipeline(
  client: GitLabClient,
  tagName: GitLabReleaseTagName,
  targetCommitSha: string,
  deadlineMs: number,
  releaseConfig: ReleaseConfig,
  signal: AbortSignal,
): Promise<GitLabPipeline> {
  return pollUntil({
    deadlineMs,
    intervalSeconds: releaseConfig.pollIntervalSeconds,
    signal,
    action: async () => {
      const pipelines = await client.listPipelinesByRef(tagName);
      const matchingPipeline = pickPipeline(pipelines, targetCommitSha);

      if (matchingPipeline) {
        return done(matchingPipeline);
      }

      logger.info(`Pipeline for tag ${tagName} is not available yet. Waiting ${releaseConfig.pollIntervalSeconds}s.`);
      return pending();
    },
    onTimeout: () => {
      throw new Error(`Pipeline for tag ${tagName} did not appear within ${releaseConfig.manualJobTimeoutMinutes} minutes.`);
    },
  });
}

async function waitForManualJob(
  client: GitLabClient,
  pipelineId: number,
  deadlineMs: number,
  releaseConfig: ReleaseConfig,
  signal: AbortSignal,
): Promise<GitLabJob> {
  return pollUntil({
    deadlineMs,
    intervalSeconds: releaseConfig.pollIntervalSeconds,
    signal,
    action: async () => {
      const pipeline = await client.getPipeline(pipelineId);
      const jobs = await client.listPipelineJobs(pipelineId);
      const namedJob = jobs.find((job) => job.name === releaseConfig.manualJobName);

      if (namedJob?.status === "manual") {
        return done(namedJob);
      }

      if (namedJob) {
        logger.info(`Manual job ${releaseConfig.manualJobName} is currently ${namedJob.status}.`);
      } else {
        logger.info(`Manual job ${releaseConfig.manualJobName} is not available yet.`);
      }

      if (terminalPipelineStatuses.has(pipeline.status)) {
        throw new Error(
          `Pipeline #${pipeline.id} finished with status ${pipeline.status} before manual job ${releaseConfig.manualJobName} became available. ${pipeline.web_url}`,
        );
      }

      return pending();
    },
    onTimeout: () => {
      throw new Error(
        `Manual job ${releaseConfig.manualJobName} did not become manual within ${releaseConfig.manualJobTimeoutMinutes} minutes.`,
      );
    },
  });
}

function pickPipeline(pipelines: GitLabPipeline[], targetCommitSha: string): GitLabPipeline | undefined {
  return pipelines.find((pipeline) => pipeline.sha === targetCommitSha) ?? pipelines[0];
}

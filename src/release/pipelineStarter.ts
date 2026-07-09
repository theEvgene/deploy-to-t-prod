import type { ReleaseConfig } from "../constants.js";
import { GitLabClient } from "../gitlab/GitLabClient.js";
import type { GitLabBridge, GitLabJob, GitLabPipeline, GitLabPipelineStatus } from "../gitlab/types.js";
import { logger } from "../logger.js";
import type { RunArtifacts } from "../artifacts/runArtifacts.js";
import { summarizeJob, summarizePipeline } from "../artifacts/runArtifacts.js";
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
const maxDownstreamPipelineDepth = 5;

type PipelineNode = {
  projectId?: number | string;
  pipelineId: number;
  depth: number;
};

type PipelineTreeGitLabClient = Pick<
  GitLabClient,
  | "getPipeline"
  | "getPipelineFromProject"
  | "listPipelineJobs"
  | "listPipelineJobsFromProject"
  | "listPipelineBridges"
>;

export type ManualJobSearchResult = {
  pipeline: GitLabPipeline;
  jobs: GitLabJob[];
  bridges: GitLabBridge[];
  namedJob?: GitLabJob;
  searchedPipelines: Array<{
    projectId?: number | string;
    pipelineId: number;
    depth: number;
    status: GitLabPipelineStatus;
    jobsCount: number;
    bridgesCount: number;
  }>;
};

export async function createTagAndStartManualJob(
  client: GitLabClient,
  tagName: GitLabReleaseTagName,
  changes: ReleaseChanges,
  releaseConfig: ReleaseConfig,
  signal: AbortSignal,
  artifacts?: RunArtifacts,
): Promise<StartReleaseResult> {
  logger.step("Creating annotated tag");
  const createdTag = await client.createAnnotatedTag(tagName, changes.latestCommit.id, changes.tagMessage);
  logger.info(`Created tag ${createdTag.name} at ${createdTag.commit.short_id}`);
  await artifacts?.trace("tag_created", {
    tagName: createdTag.name,
    targetCommit: createdTag.commit.id,
    targetShortId: createdTag.commit.short_id,
  });

  const manualJobDeadlineMs = createDeadlineMs(releaseConfig.manualJobTimeoutMinutes);

  logger.step("Searching pipeline for created tag");
  const pipeline = await waitForPipeline(client, tagName, changes.latestCommit.id, manualJobDeadlineMs, releaseConfig, signal, artifacts);
  logger.info(`Found pipeline #${pipeline.id}: ${pipeline.web_url}`);
  await artifacts?.trace("pipeline_found", {
    pipeline: summarizePipeline(pipeline),
  });

  logger.step(`Polling jobs for manual job ${releaseConfig.manualJobName}`);
  const manualJob = await waitForManualJob(client, pipeline.id, manualJobDeadlineMs, releaseConfig, signal, artifacts);
  logger.info(`Found manual job #${manualJob.id}: ${manualJob.web_url}`);
  await artifacts?.trace("manual_job_found", {
    job: summarizeJob(manualJob),
  });

  logger.step("Starting manual job");
  const playedJob = await client.playJob(manualJob.id);
  logger.info(`Manual job started: ${playedJob.web_url}`);
  await artifacts?.trace("manual_job_played", {
    job: summarizeJob(playedJob),
  });

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
  artifacts?: RunArtifacts,
): Promise<GitLabPipeline> {
  return pollUntil({
    deadlineMs,
    intervalSeconds: releaseConfig.pollIntervalSeconds,
    signal,
    action: async () => {
      const pipelines = await client.listPipelinesByRef(tagName);
      const matchingPipeline = pickPipeline(pipelines, targetCommitSha);
      await artifacts?.trace("pipeline_poll", {
        tagName,
        pipelines: pipelines.map(summarizePipeline),
        matchingPipeline: matchingPipeline ? summarizePipeline(matchingPipeline) : undefined,
      });

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
  artifacts?: RunArtifacts,
): Promise<GitLabJob> {
  return pollUntil({
    deadlineMs,
    intervalSeconds: releaseConfig.pollIntervalSeconds,
    signal,
    action: async () => {
      const result = await findManualJobInPipelineTree(client, pipelineId, releaseConfig.manualJobName);
      const { pipeline, jobs, bridges, namedJob, searchedPipelines } = result;
      await artifacts?.trace("manual_job_poll", {
        pipeline: summarizePipeline(pipeline),
        searchedPipelines,
        jobs: jobs.map(summarizeJob),
        bridges: bridges.map(summarizeBridge),
        namedJob: namedJob ? summarizeJob(namedJob) : undefined,
      });

      if (namedJob?.status === "manual") {
        return done(namedJob);
      }

      if (namedJob) {
        logger.info(`Manual job ${releaseConfig.manualJobName} is currently ${namedJob.status}: ${namedJob.web_url}`);
      } else {
        const bridgeNames = bridges.map((bridge) => bridge.name).join(", ") || "none";
        const jobNames = jobs.map((job) => job.name).join(", ") || "none";
        logger.info(
          `Manual job ${releaseConfig.manualJobName} is not available yet. Checked ${searchedPipelines.length} pipeline(s). Jobs: ${jobNames}. Bridges: ${bridgeNames}.`,
        );
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

export async function findManualJobInPipelineTree(
  client: PipelineTreeGitLabClient,
  rootPipelineId: number,
  manualJobName: string,
): Promise<ManualJobSearchResult> {
  const queue: PipelineNode[] = [{ pipelineId: rootPipelineId, depth: 0 }];
  const visited = new Set<string>();
  const allJobs: GitLabJob[] = [];
  const allBridges: GitLabBridge[] = [];
  const searchedPipelines: ManualJobSearchResult["searchedPipelines"] = [];
  let fallbackPipeline: GitLabPipeline | undefined;

  while (queue.length > 0) {
    const node = queue.shift()!;
    const visitKey = `${node.projectId ?? "root"}:${node.pipelineId}`;
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);

    const pipeline = await getPipelineForNode(client, node);
    fallbackPipeline ??= pipeline;

    const jobs = await listJobsForNode(client, node);
    const bridges = await listBridgesForNode(client, node);
    allJobs.push(...jobs);
    allBridges.push(...bridges);
    searchedPipelines.push({
      projectId: node.projectId,
      pipelineId: node.pipelineId,
      depth: node.depth,
      status: pipeline.status,
      jobsCount: jobs.length,
      bridgesCount: bridges.length,
    });

    const namedJob = jobs.find((job) => job.name === manualJobName);
    if (namedJob) {
      return {
        pipeline,
        jobs: allJobs,
        bridges: allBridges,
        namedJob,
        searchedPipelines,
      };
    }

    if (node.depth >= maxDownstreamPipelineDepth) {
      continue;
    }

    for (const bridge of bridges) {
      if (bridge.downstream_pipeline?.id) {
        queue.push({
          projectId: bridge.downstream_pipeline.project_id,
          pipelineId: bridge.downstream_pipeline.id,
          depth: node.depth + 1,
        });
      }
    }
  }

  return {
    pipeline: fallbackPipeline ?? await client.getPipeline(rootPipelineId),
    jobs: allJobs,
    bridges: allBridges,
    searchedPipelines,
  };
}

function getPipelineForNode(client: PipelineTreeGitLabClient, node: PipelineNode): Promise<GitLabPipeline> {
  return node.projectId === undefined
    ? client.getPipeline(node.pipelineId)
    : client.getPipelineFromProject(node.projectId, node.pipelineId);
}

function listJobsForNode(client: PipelineTreeGitLabClient, node: PipelineNode): Promise<GitLabJob[]> {
  return node.projectId === undefined
    ? client.listPipelineJobs(node.pipelineId)
    : client.listPipelineJobsFromProject(node.projectId, node.pipelineId);
}

function listBridgesForNode(client: PipelineTreeGitLabClient, node: PipelineNode): Promise<GitLabBridge[]> {
  return node.projectId === undefined
    ? client.listPipelineBridges(node.pipelineId)
    : client.listPipelineBridges(node.pipelineId, node.projectId);
}

function summarizeBridge(bridge: GitLabBridge): Record<string, unknown> {
  return {
    id: bridge.id,
    name: bridge.name,
    stage: bridge.stage,
    status: bridge.status,
    ref: bridge.ref,
    webUrl: bridge.web_url,
    downstreamPipeline: bridge.downstream_pipeline ? summarizePipeline(bridge.downstream_pipeline) : undefined,
  };
}

function pickPipeline(pipelines: GitLabPipeline[], targetCommitSha: string): GitLabPipeline | undefined {
  return pipelines.find((pipeline) => pipeline.sha === targetCommitSha) ?? pipelines[0];
}

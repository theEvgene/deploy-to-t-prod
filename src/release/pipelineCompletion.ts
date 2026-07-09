import type { ReleaseConfig } from "../constants.js";
import { GitLabClient } from "../gitlab/GitLabClient.js";
import type { GitLabJob, GitLabPipeline, GitLabPipelineStatus } from "../gitlab/types.js";
import { logger } from "../logger.js";
import { done, pending, pollUntil } from "../utils/poller.js";

const successStatuses = new Set<GitLabPipelineStatus>(["success"]);
const failureStatuses = new Set<GitLabPipelineStatus>(["failed", "canceled", "skipped"]);

export async function waitForPipelineCompletion(
  client: GitLabClient,
  pipelineId: number,
  releaseConfig: ReleaseConfig,
  signal: AbortSignal,
): Promise<GitLabPipeline> {
  logger.step("Waiting for pipeline completion");
  return pollUntil({
    timeoutMinutes: releaseConfig.pipelineTimeoutMinutes,
    intervalSeconds: releaseConfig.pollIntervalSeconds,
    signal,
    action: async () => {
      const pipeline = await client.getPipeline(pipelineId);
      logger.info(`Pipeline #${pipeline.id} status: ${pipeline.status}`);

      if (successStatuses.has(pipeline.status)) {
        printSuccessSummary(pipeline);
        return done(pipeline);
      }

      if (failureStatuses.has(pipeline.status)) {
        const jobs = await client.listPipelineJobs(pipeline.id);
        printFailureSummary(pipeline, jobs);
        throw new Error(`Pipeline #${pipeline.id} finished with status ${pipeline.status}.`);
      }

      return pending();
    },
    onTimeout: async () => {
      const pipeline = await client.getPipeline(pipelineId);
      const jobs = await client.listPipelineJobs(pipeline.id);
      printFailureSummary(pipeline, jobs);
      throw new Error(
        `Pipeline #${pipeline.id} did not finish within ${releaseConfig.pipelineTimeoutMinutes} minutes after manual job start.`,
      );
    },
  });
}

function printSuccessSummary(pipeline: GitLabPipeline): void {
  console.log("");
  console.log("Release pipeline completed successfully");
  console.log(`Pipeline: ${pipeline.web_url}`);
  console.log(`Status: ${pipeline.status}`);
  if (pipeline.finished_at) {
    console.log(`Finished at: ${pipeline.finished_at}`);
  }
}

function printFailureSummary(pipeline: GitLabPipeline, jobs: GitLabJob[]): void {
  console.log("");
  console.log("Release pipeline did not complete successfully");
  console.log(`Pipeline: ${pipeline.web_url}`);
  console.log(`Status: ${pipeline.status}`);
  if (pipeline.yaml_errors) {
    console.log(`YAML errors: ${pipeline.yaml_errors}`);
  }

  const failedJobs = jobs.filter((job) => finalFailureJobStatuses.has(job.status));
  if (failedJobs.length === 0) {
    console.log("Failed jobs: none reported by GitLab API");
    return;
  }

  console.log("");
  console.log("Failed jobs:");
  for (const job of failedJobs) {
    const reason = job.failure_reason ? `, reason: ${job.failure_reason}` : "";
    console.log(`- ${job.name}: ${job.status}${reason}`);
    console.log(`  ${job.web_url}`);
  }
}

const finalFailureJobStatuses = new Set(["failed", "canceled", "skipped"]);

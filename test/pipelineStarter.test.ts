import assert from "node:assert/strict";
import test from "node:test";

import type { GitLabBridge, GitLabJob, GitLabPipeline } from "../src/gitlab/types.js";
import { findManualJobInPipelineTree } from "../src/release/pipelineStarter.js";

test("finds manual job in downstream pipeline tree", async () => {
  const rootPipeline = createPipeline(100, "running");
  const firstChildPipeline = createPipeline(200, "running");
  const secondChildPipeline = createPipeline(300, "manual");
  const manualJob = createJob(3001, "deploy:production", "manual");

  const client: Parameters<typeof findManualJobInPipelineTree>[0] = {
    getPipeline: async (pipelineId) => {
      assert.equal(pipelineId, rootPipeline.id);
      return rootPipeline;
    },
    getPipelineFromProject: async (_projectId, pipelineId) => {
      if (pipelineId === firstChildPipeline.id) {
        return firstChildPipeline;
      }

      if (pipelineId === secondChildPipeline.id) {
        return secondChildPipeline;
      }

      throw new Error(`Unexpected pipeline ${pipelineId}`);
    },
    listPipelineJobs: async (pipelineId) => {
      assert.equal(pipelineId, rootPipeline.id);
      return [createJob(1001, "pipelines", "success")];
    },
    listPipelineJobsFromProject: async (_projectId, pipelineId) => {
      if (pipelineId === firstChildPipeline.id) {
        return [];
      }

      if (pipelineId === secondChildPipeline.id) {
        return [manualJob];
      }

      throw new Error(`Unexpected jobs request for pipeline ${pipelineId}`);
    },
    listPipelineBridges: async (pipelineId) => {
      if (pipelineId === rootPipeline.id) {
        return [createBridge(1002, "run:pipelines", firstChildPipeline)];
      }

      if (pipelineId === firstChildPipeline.id) {
        return [createBridge(2001, "example-ui", secondChildPipeline)];
      }

      return [];
    },
  };

  const result = await findManualJobInPipelineTree(client, rootPipeline.id, "deploy:production");

  assert.equal(result.namedJob?.id, manualJob.id);
  assert.equal(result.pipeline.id, secondChildPipeline.id);
  assert.deepEqual(result.searchedPipelines.map((pipeline) => pipeline.pipelineId), [100, 200, 300]);
});

function createPipeline(id: number, status: GitLabPipeline["status"]): GitLabPipeline {
  return {
    id,
    iid: id,
    project_id: 136551,
    ref: "release/example-ui/v1.16.0",
    sha: "71582290748cf0a66e7a03a7d52226ba0ecaba20",
    status,
    web_url: `https://gitlab.example.com/project/-/pipelines/${id}`,
  };
}

function createJob(id: number, name: string, status: GitLabJob["status"]): GitLabJob {
  return {
    id,
    name,
    stage: "deploy",
    status,
    ref: "release/example-ui/v1.16.0",
    web_url: `https://gitlab.example.com/project/-/jobs/${id}`,
    allow_failure: false,
  };
}

function createBridge(id: number, name: string, downstreamPipeline: GitLabPipeline): GitLabBridge {
  return {
    id,
    name,
    stage: "trigger",
    status: "running",
    ref: downstreamPipeline.ref,
    web_url: `https://gitlab.example.com/project/-/jobs/${id}`,
    downstream_pipeline: downstreamPipeline,
  };
}

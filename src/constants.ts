export type ReleaseConfig = Readonly<{
  gitlabBaseUrl: string;
  projectPath: string;
  branch: string;
  manualJobName: string;
  releaseTagPrefix: string;
  pollIntervalSeconds: number;
  manualJobTimeoutMinutes: number;
  pipelineTimeoutMinutes: number;
}>;

export const defaultReleaseSettings = {
  branch: "master",
  pollIntervalSeconds: 15,
  manualJobTimeoutMinutes: 15,
  pipelineTimeoutMinutes: 10,
} as const;

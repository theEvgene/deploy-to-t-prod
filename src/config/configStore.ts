import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { defaultReleaseSettings, type ReleaseConfig } from "../constants.js";

export type LocalConfig = {
  gitlabToken?: string;
  gitlabBaseUrl?: string;
  projectPath?: string;
  manualJobName?: string;
};

const configDirectoryName = "release-tag";
const configFileName = "config.json";

export function getConfigFilePath(): string {
  const appDataPath = process.env.APPDATA;

  if (!appDataPath) {
    throw new Error("APPDATA is not set. Cannot resolve local config file path.");
  }

  return join(appDataPath, configDirectoryName, configFileName);
}

export async function readConfig(): Promise<LocalConfig> {
  const configPath = getConfigFilePath();

  try {
    const content = await readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as LocalConfig;
    return {
      gitlabToken: typeof parsed.gitlabToken === "string" ? parsed.gitlabToken : undefined,
      gitlabBaseUrl: typeof parsed.gitlabBaseUrl === "string" ? parsed.gitlabBaseUrl : undefined,
      projectPath: typeof parsed.projectPath === "string" ? parsed.projectPath : undefined,
      manualJobName: typeof parsed.manualJobName === "string" ? parsed.manualJobName : undefined,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw new Error(`Cannot read local config: ${errorMessage(error)}`);
  }
}

export async function saveConfig(config: LocalConfig): Promise<void> {
  const configPath = getConfigFilePath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function setGitLabToken(token: string): Promise<void> {
  const currentConfig = await readConfig();
  await saveConfig({
    ...currentConfig,
    gitlabToken: token,
  });
}

export async function setGitLabBaseUrl(gitlabBaseUrl: string): Promise<void> {
  const currentConfig = await readConfig();
  await saveConfig({
    ...currentConfig,
    gitlabBaseUrl: normalizeGitLabBaseUrl(gitlabBaseUrl),
  });
}

export async function setProjectPath(projectPath: string): Promise<void> {
  const currentConfig = await readConfig();
  await saveConfig({
    ...currentConfig,
    projectPath: projectPath.trim(),
  });
}

export async function setManualJobName(manualJobName: string): Promise<void> {
  const currentConfig = await readConfig();
  await saveConfig({
    ...currentConfig,
    manualJobName: manualJobName.trim(),
  });
}

export async function clearGitLabToken(): Promise<void> {
  const currentConfig = await readConfig();
  delete currentConfig.gitlabToken;

  if (Object.keys(currentConfig).length === 0) {
    await rm(getConfigFilePath(), { force: true });
    return;
  }

  await saveConfig(currentConfig);
}

export async function loadReleaseConfig(): Promise<ReleaseConfig> {
  const config = await readConfig();
  const missing = [
    ["gitlabBaseUrl", config.gitlabBaseUrl],
    ["projectPath", config.projectPath],
    ["manualJobName", config.manualJobName],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Local config is incomplete. Missing: ${missing.join(", ")}. Run \`release-tag -config\`.`);
  }

  return {
    gitlabBaseUrl: config.gitlabBaseUrl!,
    projectPath: config.projectPath!,
    manualJobName: config.manualJobName!,
    releaseTagPrefix: `release/${extractProjectSlug(config.projectPath!)}/v`,
    ...defaultReleaseSettings,
  };
}

export function maskToken(token: string | undefined): string {
  if (!token) {
    return "not configured";
  }

  if (token.length <= 8) {
    return "****";
  }

  return `${token.slice(0, 6)}****${token.slice(-4)}`;
}

export function formatConfigForDisplay(config: LocalConfig): string[] {
  return [
    `GitLab token: ${maskToken(config.gitlabToken)}`,
    `GitLab URL: ${config.gitlabBaseUrl ?? "not configured"}`,
    `Project path/id: ${config.projectPath ?? "not configured"}`,
    `Manual job name: ${config.manualJobName ?? "not configured"}`,
  ];
}

function normalizeGitLabBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function extractProjectSlug(projectPath: string): string {
  const trimmed = projectPath.trim().replace(/\/$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || trimmed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

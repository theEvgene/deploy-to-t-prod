import { readConfig } from "../config/configStore.js";
import type { ReleaseConfig } from "../constants.js";
import { GitLabClient } from "../gitlab/GitLabClient.js";
import type { GitLabCommit, GitLabCompareResponse, GitLabTag } from "../gitlab/types.js";
import { logger } from "../logger.js";
import { isGitLabReleaseTagName } from "../tag.js";
import { compareTagsByCreatedAtDesc } from "./tagSelection.js";

export type ReleaseChanges = {
  latestCommit: GitLabCommit;
  previousTag: GitLabTag;
  compare: GitLabCompareResponse;
  commits: GitLabCommit[];
  tagMessage: string;
};

type PreviousTagCandidate = {
  tag: GitLabTag;
  compare: GitLabCompareResponse;
};

export async function createConfiguredGitLabClient(
  releaseConfig: ReleaseConfig,
  signal: AbortSignal,
): Promise<GitLabClient> {
  logger.step("Reading local config");
  const config = await readConfig();

  logger.step("Checking GitLab token");
  if (!config.gitlabToken) {
    throw new Error("GitLab token is not configured. Run `release-tag -config` first.");
  }

  return new GitLabClient({
    baseUrl: releaseConfig.gitlabBaseUrl,
    projectPath: releaseConfig.projectPath,
    token: config.gitlabToken,
    signal,
  });
}

export async function collectReleaseChanges(client: GitLabClient, releaseConfig: ReleaseConfig): Promise<ReleaseChanges> {
  logger.step("Checking GitLab API access");
  const project = await client.getProject();
  logger.info(`Connected to ${project.path_with_namespace}`);

  logger.step(`Finding latest ${releaseConfig.branch} commit`);
  const latestCommit = await client.getLatestBranchCommit(releaseConfig.branch);
  if (!latestCommit?.id) {
    throw new Error(`Latest ${releaseConfig.branch} commit was not found.`);
  }
  logger.info(`Latest ${releaseConfig.branch}: ${latestCommit.short_id} ${latestCommit.title}`);

  logger.step("Finding previous release tag");
  const previous = await findPreviousReleaseTag(client, latestCommit, releaseConfig);
  logger.info(`Previous release tag: ${previous.tag.name} (${previous.tag.commit.short_id})`);

  logger.step("Collecting commits for tag message");
  const commits = normalizeCommitsOldestToNewest(previous.compare.commits);
  if (commits.length === 0) {
    throw new Error(
      `No commits found between previous tag ${previous.tag.name} and latest ${releaseConfig.branch}.`,
    );
  }

  const tagMessage = commits.map((commit) => commit.title).join("\n");

  return {
    latestCommit,
    previousTag: previous.tag,
    compare: previous.compare,
    commits,
    tagMessage,
  };
}

async function findPreviousReleaseTag(
  client: GitLabClient,
  latestCommit: GitLabCommit,
  releaseConfig: ReleaseConfig,
): Promise<PreviousTagCandidate> {
  logger.info("Loading repository tags from GitLab API.");
  const fallbackTagsWithoutCreatedAt: GitLabTag[] = [];
  let loadedTagsCount = 0;
  let releaseTagsCount = 0;

  for await (const tagsPage of client.iterateTags()) {
    loadedTagsCount += tagsPage.length;
    logger.info(`Loaded ${loadedTagsCount} tags so far.`);

    const releaseTagsPage = tagsPage
      .filter((tag) => isGitLabReleaseTagName(tag.name, releaseConfig))
      .sort(compareTagsByCreatedAtDesc);

    releaseTagsCount += releaseTagsPage.length;
    logger.info(`Found ${releaseTagsCount} release tags matching ${releaseConfig.releaseTagPrefix}number.number.number so far.`);

    for (const tag of releaseTagsPage) {
      if (!tag.created_at) {
        fallbackTagsWithoutCreatedAt.push(tag);
        continue;
      }

      const previous = await tryReleaseTagCandidate(client, tag, latestCommit, releaseConfig);
      if (previous) {
        return previous;
      }
    }
  }

  if (releaseTagsCount === 0) {
    throw new Error(
      `Previous release tag was not found: no tags matching ${releaseConfig.releaseTagPrefix}number.number.number.`,
    );
  }

  if (fallbackTagsWithoutCreatedAt.length > 0) {
    logger.info(`Checking ${fallbackTagsWithoutCreatedAt.length} release tags with created_at = null as fallback.`);
  }

  for (const tag of fallbackTagsWithoutCreatedAt) {
    const previous = await tryReleaseTagCandidate(client, tag, latestCommit, releaseConfig);
    if (previous) {
      return previous;
    }
  }

  throw new Error(
    `Previous release tag was not found in ${releaseConfig.branch} history before ${latestCommit.short_id}.`,
  );
}

async function tryReleaseTagCandidate(
  client: GitLabClient,
  tag: GitLabTag,
  latestCommit: GitLabCommit,
  releaseConfig: ReleaseConfig,
): Promise<PreviousTagCandidate | undefined> {
  logger.info(
    `Checking release tag: ${tag.name} (${tag.commit.short_id}, created_at: ${tag.created_at ?? "null"})`,
  );

  if (tag.commit.id === latestCommit.id) {
    logger.info(`Skipping ${tag.name}: it points to latest ${releaseConfig.branch} commit.`);
    return undefined;
  }

  const compare = await client.compareRefs(tag.commit.id, latestCommit.id);
  if (compare.compare_same_ref || compare.commits.length === 0) {
    logger.info(`Skipping ${tag.name}: it is not before latest ${releaseConfig.branch} commit.`);
    return undefined;
  }

  logger.info(`Selected previous release tag: ${tag.name}.`);
  logger.info(`${compare.commits.length} commits found until latest ${releaseConfig.branch}.`);

  return {
    tag,
    compare,
  };
}

function normalizeCommitsOldestToNewest(commits: GitLabCommit[]): GitLabCommit[] {
  return [...commits].sort((left, right) => {
    const leftDate = getCommitDate(left);
    const rightDate = getCommitDate(right);
    return leftDate.localeCompare(rightDate);
  });
}

function getCommitDate(commit: GitLabCommit): string {
  return commit.committed_date ?? commit.created_at ?? commit.authored_date ?? "";
}

import type { ReleaseConfig } from "../constants.js";
import type { GitLabReleaseTagName } from "../tag.js";
import type { ReleaseChanges } from "./changeCollector.js";

export function printChanges(changes: ReleaseChanges): void {
  console.log(formatChanges(changes));
}

export function printReleasePreview(
  tagName: GitLabReleaseTagName,
  changes: ReleaseChanges,
  releaseConfig: ReleaseConfig,
): void {
  console.log(formatReleasePreview(tagName, changes, releaseConfig));
}

export function formatChanges(changes: ReleaseChanges): string {
  return [
    "",
    "Changes since previous release tag",
    "",
    "Previous release:",
    `  Tag: ${changes.previousTag.name}`,
    `  Commit: ${changes.previousTag.commit.short_id}`,
    `  Title: ${changes.previousTag.commit.title}`,
    "",
    "Latest master:",
    `  Commit: ${changes.latestCommit.short_id}`,
    `  Title: ${changes.latestCommit.title}`,
    "",
    "Commit titles:",
    ...changes.commits.map((commit) => `- ${commit.title}`),
  ].join("\n");
}

export function formatReleasePreview(
  tagName: GitLabReleaseTagName,
  changes: ReleaseChanges,
  releaseConfig: ReleaseConfig,
): string {
  return [
    "",
    "Release preview",
    "",
    "New release:",
    `  Tag: ${tagName}`,
    `  Target commit: ${changes.latestCommit.id}`,
    `  Target title: ${changes.latestCommit.title}`,
    "",
    "Previous release:",
    `  Tag: ${changes.previousTag.name}`,
    `  Commit: ${changes.previousTag.commit.id}`,
    `  Title: ${changes.previousTag.commit.title}`,
    "",
    "Pipeline:",
    `  Manual job: ${releaseConfig.manualJobName}`,
    "",
    "Tag message:",
    ...formatIndentedTagMessage(changes.tagMessage),
    "",
  ].join("\n");
}

function formatIndentedTagMessage(tagMessage: string): string[] {
  return tagMessage.split("\n").map((line) => `  ${line}`);
}

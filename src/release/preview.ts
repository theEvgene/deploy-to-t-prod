import type { ReleaseConfig } from "../constants.js";
import type { GitLabReleaseTagName } from "../tag.js";
import type { ReleaseChanges } from "./changeCollector.js";

export function printChanges(changes: ReleaseChanges): void {
  console.log("");
  console.log("Changes since previous release tag");
  console.log("");
  console.log("Previous release:");
  console.log(`  Tag: ${changes.previousTag.name}`);
  console.log(`  Commit: ${changes.previousTag.commit.short_id}`);
  console.log(`  Title: ${changes.previousTag.commit.title}`);
  console.log("");
  console.log("Latest master:");
  console.log(`  Commit: ${changes.latestCommit.short_id}`);
  console.log(`  Title: ${changes.latestCommit.title}`);
  console.log("");
  console.log("Commit titles:");
  for (const commit of changes.commits) {
    console.log(`- ${commit.title}`);
  }
}

export function printReleasePreview(
  tagName: GitLabReleaseTagName,
  changes: ReleaseChanges,
  releaseConfig: ReleaseConfig,
): void {
  console.log("");
  console.log("Release preview");
  console.log("");
  console.log("New release:");
  console.log(`  Tag: ${tagName}`);
  console.log(`  Target commit: ${changes.latestCommit.id}`);
  console.log(`  Target title: ${changes.latestCommit.title}`);
  console.log("");
  console.log("Previous release:");
  console.log(`  Tag: ${changes.previousTag.name}`);
  console.log(`  Commit: ${changes.previousTag.commit.id}`);
  console.log(`  Title: ${changes.previousTag.commit.title}`);
  console.log("");
  console.log("Pipeline:");
  console.log(`  Manual job: ${releaseConfig.manualJobName}`);
  console.log("");
  console.log("Tag message:");
  printIndentedTagMessage(changes.tagMessage);
  console.log("");
}

function printIndentedTagMessage(tagMessage: string): void {
  for (const line of tagMessage.split("\n")) {
    console.log(`  ${line}`);
  }
}

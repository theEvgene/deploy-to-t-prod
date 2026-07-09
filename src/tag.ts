import type { ReleaseConfig } from "./constants.js";

const releaseVersionPattern = /^\d+\.\d+\.\d+$/;

export type ReleaseVersion = string & { readonly __brand: "ReleaseVersion" };
export type GitLabReleaseTagName = string & { readonly __brand: "GitLabReleaseTagName" };

export function isValidReleaseVersion(version: string): version is ReleaseVersion {
  return releaseVersionPattern.test(version);
}

export function isGitLabReleaseTagName(
  tagName: string,
  releaseConfig: ReleaseConfig,
): tagName is GitLabReleaseTagName {
  return tagName.startsWith(releaseConfig.releaseTagPrefix)
    && releaseVersionPattern.test(tagName.slice(releaseConfig.releaseTagPrefix.length));
}

export function parseReleaseVersion(value: string): ReleaseVersion {
  if (isValidReleaseVersion(value)) {
    return value;
  }

  throw new Error(
    `Invalid tag version "${value}". Expected format: number.number.number, for example 14.1.13.`,
  );
}

export function parseGitLabReleaseTagName(value: string, releaseConfig: ReleaseConfig): GitLabReleaseTagName {
  if (isGitLabReleaseTagName(value, releaseConfig)) {
    return value;
  }

  throw new Error(
    `Invalid GitLab release tag "${value}". Expected format: ${releaseConfig.releaseTagPrefix}number.number.number.`,
  );
}

export function toGitLabReleaseTagName(
  version: ReleaseVersion,
  releaseConfig: ReleaseConfig,
): GitLabReleaseTagName {
  return `${releaseConfig.releaseTagPrefix}${version}` as GitLabReleaseTagName;
}

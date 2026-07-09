import type { GitLabTag } from "../gitlab/types.js";

export function compareTagsByCreatedAtDesc(left: GitLabTag, right: GitLabTag): number {
  if (!left.created_at && !right.created_at) {
    return 0;
  }

  if (!left.created_at) {
    return 1;
  }

  if (!right.created_at) {
    return -1;
  }

  return Date.parse(right.created_at) - Date.parse(left.created_at);
}


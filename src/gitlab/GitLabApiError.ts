export class GitLabApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }

  static async fromResponse(response: Response, method: string, url: string): Promise<GitLabApiError> {
    const responseText = await response.text();
    const details = formatResponseDetails(responseText);
    const authHint = response.status === 401 || response.status === 403
      ? " Check that the configured GitLab token is valid and has enough permissions."
      : "";

    return new GitLabApiError(
      `GitLab API ${method} ${url} failed with ${response.status} ${response.statusText}.${details}${authHint}`,
      response.status,
      method,
      url,
    );
  }
}

function formatResponseDetails(responseText: string): string {
  if (!responseText.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(responseText) as unknown;
    const message = extractGitLabMessage(parsed);
    return message ? ` ${message}` : ` ${truncate(responseText)}`;
  } catch {
    return ` ${truncate(responseText)}`;
  }
}

function extractGitLabMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const message = record.message ?? record.error;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message.map(String).join("; ");
  }

  if (message && typeof message === "object") {
    return Object.entries(message)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : String(item)}`)
      .join("; ");
  }

  return undefined;
}

function truncate(value: string): string {
  const maxLength = 500;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}


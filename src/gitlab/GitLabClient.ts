import { GitLabApiError } from "./GitLabApiError.js";
import { logger } from "../logger.js";
import { UserAbortError } from "../utils/abort.js";
import type {
  GitLabBranch,
  GitLabClientConfig,
  GitLabCommit,
  GitLabCompareResponse,
  GitLabJob,
  GitLabJobStatus,
  GitLabPipeline,
  GitLabProject,
  GitLabTag,
} from "./types.js";

type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue | QueryValue[]>;
const requestTimeoutMs = 30_000;

export class GitLabClient {
  private readonly baseApiUrl: string;
  private readonly projectId: string;

  constructor(private readonly config: GitLabClientConfig) {
    this.baseApiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v4`;
    this.projectId = encodeURIComponent(config.projectPath);
  }

  getProject(): Promise<GitLabProject> {
    return this.request<GitLabProject>("GET", `/projects/${this.projectId}`);
  }

  async getLatestBranchCommit(branch: string): Promise<GitLabCommit> {
    const result = await this.request<GitLabBranch>(
      "GET",
      `/projects/${this.projectId}/repository/branches/${encodeURIComponent(branch)}`,
    );

    return result.commit;
  }

  listTags(): Promise<GitLabTag[]> {
    return this.requestAllPages<GitLabTag>("GET", `/projects/${this.projectId}/repository/tags`, {
      per_page: 100,
      order_by: "updated",
      sort: "desc",
    });
  }

  async *iterateTags(): AsyncGenerator<GitLabTag[]> {
    for await (const page of this.requestPages<GitLabTag>("GET", `/projects/${this.projectId}/repository/tags`, {
      per_page: 100,
      order_by: "updated",
      sort: "desc",
    })) {
      yield page;
    }
  }

  async getTag(tagName: string): Promise<GitLabTag | undefined> {
    try {
      return await this.request<GitLabTag>(
        "GET",
        `/projects/${this.projectId}/repository/tags/${encodeURIComponent(tagName)}`,
      );
    } catch (error) {
      if (error instanceof GitLabApiError && error.status === 404) {
        return undefined;
      }

      throw error;
    }
  }

  compareRefs(from: string, to: string): Promise<GitLabCompareResponse> {
    return this.request<GitLabCompareResponse>("GET", `/projects/${this.projectId}/repository/compare`, {
      query: {
        from,
        to,
        straight: true,
      },
    });
  }

  listCommits(refName: string, perPage = 100): Promise<GitLabCommit[]> {
    return this.requestAllPages<GitLabCommit>("GET", `/projects/${this.projectId}/repository/commits`, {
      ref_name: refName,
      per_page: perPage,
    });
  }

  createAnnotatedTag(tagName: string, ref: string, message: string): Promise<GitLabTag> {
    return this.request<GitLabTag>("POST", `/projects/${this.projectId}/repository/tags`, {
      body: {
        tag_name: tagName,
        ref,
        message,
      },
    });
  }

  listPipelinesByRef(ref: string): Promise<GitLabPipeline[]> {
    return this.requestAllPages<GitLabPipeline>("GET", `/projects/${this.projectId}/pipelines`, {
      ref,
      per_page: 100,
    });
  }

  getPipeline(pipelineId: number): Promise<GitLabPipeline> {
    return this.request<GitLabPipeline>("GET", `/projects/${this.projectId}/pipelines/${pipelineId}`);
  }

  listPipelineJobs(pipelineId: number, scopes?: GitLabJobStatus[]): Promise<GitLabJob[]> {
    return this.requestAllPages<GitLabJob>("GET", `/projects/${this.projectId}/pipelines/${pipelineId}/jobs`, {
      include_retried: true,
      per_page: 100,
      "scope[]": scopes,
    });
  }

  playJob(jobId: number): Promise<GitLabJob> {
    return this.request<GitLabJob>("POST", `/projects/${this.projectId}/jobs/${jobId}/play`);
  }

  private async requestAllPages<T>(
    method: "GET",
    path: string,
    query: QueryParams,
  ): Promise<T[]> {
    const results: T[] = [];

    for await (const data of this.requestPages<T>(method, path, query)) {
      results.push(...data);
      logger.info(`GitLab API ${method} ${path}: loaded ${results.length} items total.`);
    }

    return results;
  }

  private async *requestPages<T>(
    method: "GET",
    path: string,
    query: QueryParams,
  ): AsyncGenerator<T[]> {
    let page = 1;

    while (true) {
      logger.info(`GitLab API ${method} ${path}: loading page ${page}.`);
      const { data, nextPage } = await this.requestWithMeta<T[]>(method, path, {
        query: {
          ...query,
          page,
        },
      });

      yield data;

      if (!nextPage) {
        return;
      }

      page = nextPage;
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: QueryParams; body?: Record<string, string> } = {},
  ): Promise<T> {
    const { data } = await this.requestWithMeta<T>(method, path, options);
    return data;
  }

  private async requestWithMeta<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: QueryParams; body?: Record<string, string> } = {},
  ): Promise<{ data: T; nextPage?: number }> {
    const url = this.buildUrl(path, options.query);
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: this.buildHeaders(Boolean(options.body)),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.any([this.config.signal, AbortSignal.timeout(requestTimeoutMs)]),
      });
    } catch (error) {
      if (this.config.signal.aborted) {
        throw new UserAbortError();
      }

      throw new Error(`GitLab API ${method} ${url} request failed: ${formatFetchError(error)}`);
    }

    if (!response.ok) {
      throw await GitLabApiError.fromResponse(response, method, url);
    }

    const nextPageHeader = response.headers.get("x-next-page");
    return {
      data: await response.json() as T,
      nextPage: nextPageHeader ? Number(nextPageHeader) : undefined,
    };
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.baseApiUrl}${path}`);

    if (query) {
      for (const [key, rawValue] of Object.entries(query)) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const value of values) {
          if (value !== undefined) {
            url.searchParams.append(key, String(value));
          }
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(hasJsonBody: boolean): HeadersInit {
    const headers: Record<string, string> = {
      "PRIVATE-TOKEN": this.config.token,
    };

    if (hasJsonBody) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  }
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "request was aborted";
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return `request timed out after ${requestTimeoutMs / 1000}s`;
  }

  return error instanceof Error ? error.message : String(error);
}

export type GitLabClientConfig = {
  baseUrl: string;
  projectPath: string;
  token: string;
  signal: AbortSignal;
};

export type GitLabCommit = {
  id: string;
  short_id: string;
  title: string;
  message?: string;
  parent_ids?: string[];
  authored_date?: string;
  committed_date?: string;
  created_at?: string;
  web_url?: string;
};

export type GitLabBranch = {
  name: string;
  commit: GitLabCommit;
};

export type GitLabTag = {
  name: string;
  target: string;
  message: string | null;
  protected: boolean;
  created_at: string | null;
  commit: GitLabCommit;
};

export type GitLabCompareResponse = {
  commit: GitLabCommit;
  commits: GitLabCommit[];
  compare_same_ref: boolean;
  compare_timeout: boolean;
  web_url: string;
};

export type GitLabPipelineStatus =
  | "created"
  | "waiting_for_resource"
  | "preparing"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "skipped"
  | "manual"
  | "scheduled";

export type GitLabPipeline = {
  id: number;
  iid?: number;
  project_id: number;
  ref: string;
  sha: string;
  status: GitLabPipelineStatus;
  source?: string;
  web_url: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  tag?: boolean;
  yaml_errors?: string | null;
};

export type GitLabJobStatus =
  | "created"
  | "pending"
  | "running"
  | "failed"
  | "success"
  | "canceled"
  | "canceling"
  | "skipped"
  | "waiting_for_resource"
  | "manual"
  | "scheduled"
  | "preparing"
  | "waiting_for_callback";

export type GitLabJob = {
  id: number;
  name: string;
  stage: string;
  status: GitLabJobStatus;
  ref: string;
  web_url: string;
  allow_failure: boolean;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  failure_reason?: string;
  pipeline?: {
    id: number;
    project_id: number;
    ref: string;
    sha: string;
    status: GitLabPipelineStatus;
  };
};

export type GitLabProject = {
  id: number;
  path_with_namespace: string;
  web_url: string;
};

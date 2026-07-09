# deploy-to-t-prod

CLI utility for preparing and running a GitLab release tag flow.

The repository is safe to publish publicly because project-specific values are stored locally through the config menu, not in tracked files.

## What is configured locally

Run:

```powershell
release-tag -config
```

The config menu stores these values in `%APPDATA%\release-tag\config.json`:

1. GitLab access token.
2. Manual job name.
3. GitLab URL.
4. Project path or id.

Examples of local-only values:

```text
https://gitlab.example.com
group/project-name
deploy:production
```

Do not commit real project values or tokens. The local config file lives outside this repository.

## Release tag format

You pass only the version:

```powershell
release-tag 1.23.45
```

The GitLab tag is built from the configured project name:

```text
release/<project-name>/v1.23.45
```

For example, if the configured project path is:

```text
group/example-ui
```

then the tag is:

```text
release/example-ui/v1.23.45
```

## Install dependencies

```powershell
cd C:\Users\<user>\Documents\repositories\deploy-to-t-prod
npm install
```

## Build

```powershell
npm run build
```

## Make `release-tag` available from any folder

For local machine usage, link this project globally:

```powershell
cd C:\Users\<user>\Documents\repositories\deploy-to-t-prod
npm run build
npm link
```

After that, you can run the CLI from any local folder:

```powershell
release-tag
release-tag 1.23.45 --dry-run
release-tag 1.23.45
release-tag -config
```

To remove the global link later:

```powershell
npm unlink -g deploy-to-t-prod
```

If you do not want to link globally, run the dev command from the project folder:

```powershell
npm run dev --
npm run dev -- 1.23.45 --dry-run
npm run dev -- 1.23.45
npm run dev -- -config
```

## Configure

Run:

```powershell
release-tag -config
```

or, without global linking:

```powershell
npm run dev -- -config
```

The config menu allows you to:

1. Set/update GitLab token.
2. Set manual job name.
3. Set GitLab URL.
4. Set project path or id.
5. Show current config with masked token.
6. Exit.

The token is shown only in masked form and is not printed in logs.

## Show changes without creating a tag

Run:

```powershell
release-tag
```

The script will:

1. Read local config.
2. Check GitLab token.
3. Get latest configured branch commit from GitLab.
4. Find the previous release tag matching `release/<project-name>/v<number.number.number>`.
5. Print commit titles from previous release tag to latest branch commit.

No tag is created in this mode.

## Dry-run a release

Run:

```powershell
release-tag 1.23.45 --dry-run
```

or:

```powershell
release-tag 1.23.45 -dry
```

The script prints the full preview and tag message, but does not create the tag and does not start the pipeline job.

## Run a real release

Run:

```powershell
release-tag 1.23.45
```

The script will:

1. Validate version format `number.number.number`.
2. Convert it to GitLab tag `release/<project-name>/v1.23.45`.
3. Check that this tag does not already exist.
4. Find latest configured branch commit.
5. Find previous release tag.
6. Build plain text tag message from commit titles.
7. Show release preview.
8. Ask for confirmation:

```text
Continue and create tag? [yes/no]:
```

Accepted yes answers:

```text
yes
y
да
```

Accepted no answers:

```text
no
n
нет
exit
```

After `yes`, the script will:

1. Create an annotated GitLab tag through GitLab API.
2. Wait for the tag pipeline.
3. Wait for configured manual job.
4. Start that manual job through GitLab API.
5. Wait for final pipeline status.
6. Print success or failure summary.

## Run artifacts

For real release runs, artifacts are created only after the confirmation answer is accepted.
Cancelled previews and dry-runs are not stored.

Artifacts are stored outside the repository:

```text
%APPDATA%\release-tag\runs
```

Each confirmed run gets its own directory with:

- `run.json`: run metadata and final status.
- `preview.txt`: the preview shown before confirmation.
- `trace.jsonl`: structured event trace for tag, pipeline, manual job, and errors.
- `console.log`: CLI log lines written after confirmation.
- `error.json`: error details, only when the run fails or is cancelled after confirmation.

Only the latest 10 confirmed run directories are kept. Older artifact directories are removed automatically.
The GitLab token is never written to run artifacts.

## Stop execution

Press:

```text
Ctrl+C
```

The script stops with exit code `130` and does not continue polling or job actions after the abort signal.

## Errors covered

The CLI reports readable errors for these situations:

- Local config is incomplete.
- GitLab token is not configured.
- GitLab API returns `401` or `403`.
- Latest branch commit is not found.
- Previous release tag is not found.
- No commits exist between previous release tag and latest branch commit.
- Requested tag already exists.
- Pipeline for created tag does not appear before timeout.
- Manual job does not become available before timeout.
- Manual job cannot be started.
- Pipeline finishes with `failed`, `canceled`, or `skipped`.
- GitLab API request timeout.

## Timeouts

- Poll interval: `15` seconds.
- Manual job timeout: `15` minutes.
- Pipeline completion timeout: `10` minutes after manual job start.

## Development checks

```powershell
npm run build
npm test
npm run check
```

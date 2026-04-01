# IKG Studio Dataset Manager

Web application for managing YOLO datasets — multi-user job assignment, duplicate handling, built-in label editor, and archive tracking.

## What It Does

- **Dataset Types** — admin configures types (e.g. `dice`, `roulette`) with an *uncheck path* (work-in-progress) and a *check path* (completed). Datasets can be moved from uncheck → check via rsync with hash verification.
- **Dataset & Job management** — datasets are split into fixed-size jobs and assigned to labelers. Progress is tracked per user per job.
- **Multi-dataset creation** — add multiple datasets at once by selecting several subdirectories in one flow, with shared or per-dataset duplicate settings and optional auto-assign.
- **Move to Check** — admin/data-manager initiates a background rsync move, verifies a metadata hash, removes the source files, and archives the dataset record (the record is retained for history rather than deleted).
- **Archive** — after a successful move, datasets appear on the Archive page with full statistics: edit counts, deletion counts, job assignments, and who moved it to done.
- **Edit statistics** — the system tracks which label files were edited per job by hashing every `labels/*.txt` at baseline (when a dataset is added) and updating the hash on every save. The dataset detail page and dashboard show edited-file and deleted-image counts in real time.
- **Bulk move** — admin/data-manager can select multiple datasets and move them all to check in one operation.
- **Label editor** — browser-based YOLO bounding-box / OBB editor with multi-image quick-edit tools and thumbnail strip.
- **Viewer** — browse all images in a dataset or job; admin/data-manager view is read-only (no edit, no delete).
- **Duplicate detection** — configurable IoU-based duplicate scan runs as a background task when a dataset is added.
- **Real-time updates** — Server-Sent Events push job status, move progress, task logs, and edit statistics live to all open tabs. A SharedWorker pools connections so multiple tabs share one EventSource per URL.
- **Role-based access** — three roles: `admin`, `data-manager`, `user`. All routes are JWT-protected.
- **PostgreSQL** — stores users, datasets, jobs, settings, background task logs, assignment history, label hashes, and image deletions.

---

## Requirements

- Docker + Docker Compose (recommended)
- Node.js 20+ and PostgreSQL 16+ if running locally

---

## Quick Start (Docker — Production)

### 1. Copy and configure the compose file

```bash
cp compose.example.yml compose.yml
```

Edit `compose.yml` and add a volume mount for **every path** you intend to use as an `uncheck_path` or `check_path` in dataset type settings. Each path must be mounted at the **same absolute path** as on the host:

```yaml
volumes:
  - /data/work:/data/work:rw          # your uncheck_path
  - /mnt/smb/check:/mnt/smb/check:rw  # your check_path (SMB share, etc.)
  - ./deletion_logs:/app/deletion_logs:rw
```

If paths are on SMB or NFS, mount them on the host first — Docker bind-mounts whatever the host sees at startup.

### 2. Configure environment

```bash
cp .env.example .env
```

Set at minimum:

| Variable | Notes |
| --- | --- |
| `JWT_SECRET` | Required. Generate with `openssl rand -base64 32` |
| `PUBLIC_ADDRESS` | Hostname/IP users use to reach the app (default: `localhost`) |
| `INITIAL_ADMIN_PASSWORD` | Seed password for the `admin` account (default: `admin`) |

### 3. Start

```bash
docker compose up -d
```

Open `http://localhost:3000` (or the `PUBLIC_ADDRESS`:`MANAGER_PORT` you configured).

The app seeds an initial admin account on first startup — username `admin`, password from `INITIAL_ADMIN_PASSWORD`.

---

## Quick Start (Docker — Development)

The dev compose file mounts your source code into a `node:20-slim` container and runs `npm run dev`, giving you hot reload without a build step.

### 1. Copy and configure

```bash
cp compose.dev.example.yml compose.dev.yml
```

Edit `compose.dev.yml` and uncomment the dataset path volume mounts you need (same rules as production — same absolute path as on the host).

### 2. Configure environment

Same `.env` as production. `API_LOG_LEVEL` defaults to `debug` in the dev compose.

### 3. Start

```bash
docker compose -f compose.dev.yml up
```

The dev server starts at `http://localhost:3000`. Source changes reload automatically. PostgreSQL data is stored in `./postgres-data-dev` (separate from any production data on the same machine).

> **Note:** `compose.dev.yml` is git-ignored. Commit `compose.dev.example.yml` and edit `compose.dev.yml` locally.

---

## Quick Start (Local)

```bash
npm install
```

Point `DATABASE_URL` at a running PostgreSQL instance, then:

```bash
npm run dev       # development
npm run build && npm start  # production
```

---

## Environment Variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | **Yes** | — | Session signing secret |
| `DATABASE_URL` | **Yes (local only)** | — | PostgreSQL connection string. Docker Compose hardcodes this internally. |
| `INITIAL_ADMIN_PASSWORD` | No | `admin` | Seed password for the `admin` user |
| `PUBLIC_ADDRESS` | No | `localhost` | Hostname/IP for the app |
| `MANAGER_PORT` | No | `3000` | Web server port |
| `DEFAULT_IOU_THRESHOLD` | No | `0.8` | Default duplicate IoU threshold for new datasets |
| `DEFAULT_DEBUG_MODE` | No | `false` | Default duplicate debug mode |
| `LABEL_EDITOR_PRELOAD_COUNT` | No | `25` | Images preloaded by the label editor |
| `VIEWER_IMAGE_LOADING_BATCH_COUNT` | No | `200` | Max concurrent thumbnail loads in the viewer |
| `THUMBNAIL_QUALITY` | No | `50` | JPEG quality for thumbnails (1–100) |
| `API_LOG_LEVEL` | No | `info` | `info`, `debug`, or `silent` |
| `AVAILABLE_OBB_MODES` | No | `rectangle,4point` | OBB creation modes shown in settings |
| `DUPLICATE_RULES` | No | — | JSON array of path-based duplicate rules (see below) |
| `DUPLICATE_DEFAULT_ACTION` | No | `move` | Fallback duplicate action: `move`, `delete`, or `skip` |

Reference template: [`.env.example`](.env.example)

---

## Dataset Types & Move to Check

### Configure types (admin → Settings)

Each type has:
- **Name** — label shown in the UI (e.g. `dice`)
- **Uncheck Path** — root directory where work-in-progress datasets live
- **Check Path** — destination root for completed datasets

Uncheck Path and Check Path must be different. Data-managers can view types (but not edit them).

### Add datasets

On the dashboard, click **+ Add Dataset**. The flow has two steps:

**Step 1 — Select**
- Pick a dataset type (auto-selected if only one is configured)
- Check one or more subdirectories from the available list (subdirs with `images/` + `labels/` not already registered)

**Step 2 — Review & Create**
- Review the list of datasets to be created (name and image count)
- Set OBB format and optionally edit the class file per dataset
- Configure duplicate detection (shared settings applied to all, or switch to individual mode for per-dataset overrides)
- Optionally select **Assign To** — all jobs created for every dataset in this batch will be auto-assigned to the chosen user

A valid dataset directory must contain:

```
my-dataset/
  images/
  labels/
```

When a dataset is created, a background task runs automatically: it computes an MD5 baseline hash for every `labels/*.txt` file, storing each hash in the database so the system can detect future edits.

### Move to Check

On the dataset detail page (or from the dashboard for bulk selection), admin/data-manager can click **Move to Check**. The system will:

1. Enqueue a background job via pg-boss
2. rsync the dataset directory to `check_path/subdir`
3. Verify a metadata hash (filename + size + mtime) between source and destination
4. Delete the source directory
5. **Archive** the dataset record (record is retained with `archived_at` timestamp; removed from the main dashboard)

While a move is in progress the dataset is locked — edits, deletes, and job actions are blocked. The dashboard card shows the current move status (Pending / Moving / Verifying). If the move fails, the error is shown on the detail page with a **Retry** option. The retry limit is configurable in Settings (`move_retry_limit`, default `3`).

Progress for both duplicate-scan and move-to-check jobs is visible in the **Background Tasks** page (admin/data-manager).

---

## Archive

After a successful move-to-check, the dataset is archived. Admin and data-manager can view all archived datasets at **/archive**:

- Dataset name, original path, and destination path
- Who moved it to done and when
- Per-job edit statistics: how many label files were edited and how many images were deleted
- Full job assignment history (who worked on each job and for how long)

Archived records are read-only — they are never deleted from the database.

---

## Edit Statistics

The system tracks editing activity at the per-job and per-dataset level.

**How it works:**
1. When a dataset is created, a background task hashes every `labels/*.txt` file (MD5, with coordinate precision normalization) and stores the `initial_hash`.
2. Every time the label editor saves a file, the system recomputes the hash and stores it as `current_hash`.
3. A file is counted as **edited** when `current_hash ≠ initial_hash` (or the file was created after the baseline, i.e. `initial_hash IS NULL`).
4. A file is counted as **deleted** when a delete-images action records it in the `deleted_images` table.

**Where stats are shown:**
- Dataset detail page → progress card (total edited files, total deleted images for the whole dataset)
- Dataset detail page → jobs table (per-job edited and deleted counts)
- Dashboard job cards (user and data-manager views) — per-job counts alongside current image count
- Archive page — per-job and per-dataset totals for completed datasets

Stats update automatically every ~2 seconds via SSE while the dataset page is open.

---

## Roles

| Role | Capabilities |
| --- | --- |
| `admin` | Everything: dataset types, system settings, users, move to check, archive |
| `data-manager` | Create/manage datasets, assign/reassign jobs, move to check, view archive, bulk move |
| `user` | View assigned jobs, open label editor, mark jobs as done |

---

## Duplicate Handling

Duplicate detection runs automatically as a background task when a dataset is added. Two layers of configuration:

**Per-dataset (set at creation time):**
- IoU threshold, debug mode, action (`move` / `delete` / `skip`), label count filter

**Global rules (`DUPLICATE_RULES` env var):**

```env
DUPLICATE_RULES=[{"pattern":"invalid","action":"skip","labels":0,"priority":1},{"pattern":"dice","action":"delete","labels":3,"priority":2}]
```

Rule fields: `pattern` (substring match on dataset path), `action`, `labels` (0 = all), `priority` (lower wins). `DUPLICATE_DEFAULT_ACTION` applies when no rule matches.

---

## Real-Time Updates

The app uses Server-Sent Events (SSE) to push changes live without polling:

| Stream URL | What it pushes |
| --- | --- |
| `/api/datasets/[id]/stream` | Job statuses, move progress, edit stats for one dataset |
| `/api/my-jobs/stream` | Assigned jobs list for the current user |
| `/api/tasks/stream` | Background task status and log lines |

A **SharedWorker** (`public/sse-worker.js`) is used on the client so all browser tabs from the same origin share one EventSource per URL. New tabs receive the last cached message immediately without waiting for the next server push.

---

## Database Tables

| Table | Purpose |
| --- | --- |
| `users` | Accounts, roles, hashed passwords, token version |
| `datasets` | Dataset metadata, move status, archive timestamp/path |
| `jobs` | Job ranges, assignment, status, image name anchors |
| `job_user_state` | Per-user last image, selected images, filter/sort state |
| `job_assignment_history` | Audit log of all assignments and reassignments |
| `dataset_types` | Type configuration (name, uncheck_path, check_path) |
| `system_settings` | Global settings (job_size, move_retry_limit, etc.) |
| `user_preferences` | Per-user keyboard shortcuts |
| `label_file_hashes` | Baseline and current hash per label file for edit detection |
| `deleted_images` | Record of every image deletion (job, user, timestamp) |
| `task_logs` | Human-readable log lines for pg-boss background tasks |
| `instances` | Legacy dataset records (migrated from `instances.json`) |

---

## Docker Compose Notes

`compose.yml` (copied from `compose.example.yml`) runs:

- `postgres` on port `5432`
- `ikg-studio-dataset-manager` on `MANAGER_PORT`

Persisted data:
- `./postgres-data` — PostgreSQL data
- `./deletion_logs` — deletion audit output

`compose.yml` is git-ignored. Commit `compose.example.yml` and edit `compose.yml` locally on each machine.

---

## Authentication

All pages and API routes except `/login` and `/logout` are protected by `middleware.js`. No valid JWT cookie → redirect to `/login` (pages) or `401` (API).

The initial admin account is seeded on first startup if the `users` table is empty.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| App fails to start | Check `JWT_SECRET` and `DATABASE_URL` |
| File browser shows empty / wrong root | Verify the path is mounted in the container at the same absolute path |
| Move to Check fails with "rsync not found" | Rebuild the Docker image (`docker compose build`) — `rsync` is installed in the Dockerfile |
| Move fails hash mismatch | Usually a partial rsync; retry will re-rsync and re-verify |
| Public address wrong in shared links | Set `PUBLIC_ADDRESS` in `.env` |
| Docker build fails with "parent snapshot does not exist" | Corrupted BuildKit cache — run `docker builder prune -f && docker compose build --no-cache` |
| Edit stats always show 0 | Baseline hash task may not have completed — check Background Tasks page for errors |
| Archive page empty after move | Check that the move completed successfully (no errors in Background Tasks) |

---

## Migration Scripts

- `scripts/migrate-to-datasets.js` — migrate legacy instance-oriented records to dataset/job structure

Run with the same `DATABASE_URL` used by the app.

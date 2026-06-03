# Sideops

A self-hosted deployment platform that lets you ship any GitHub repo to a public URL in seconds. Push your code, get a link — no configuration required.

## How It Works

Sideops is built around three independent services that talk through Redis:

```
User / Frontend
      │
      ▼
 api-server  ──(BullMQ job)──▶  build-server
  :3001                              │
      │                         clone → build → upload to S3
      │◀───── Redis Pub/Sub ─────────┘
      │        (logs + status)
      ▼
s3-reverse-proxy
  :8000
  Routes <projectId>.yourdomain.com → S3 bucket path
```

1. **api-server** accepts a GitHub URL, queues a build job, and streams live logs back to the browser over SSE.
2. **build-server** pulls the repo, detects the package manager, runs the build, and uploads the `dist/` folder to S3 under `/<projectId>/dist/`.
3. **s3-reverse-proxy** sits in front of S3 and routes requests by subdomain — `abc123.yourdomain.com` proxies to `s3://your-bucket/abc123/dist/`.

## Project Structure

```
sideops/
├── api-server/          # REST API + SSE log streaming
│   └── src/
│       ├── index.js     # Express app entry point
│       ├── routes/      # /projects routes
│       └── lib/         # Redis, BullMQ queue, in-memory store
├── build-server/        # BullMQ worker: clone → build → upload
│   └── src/
│       ├── index.js     # Worker entry point
│       ├── builder.js   # git clone + npm/pnpm/yarn build
│       ├── uploader.js  # S3 streaming upload
│       └── publisher.js # Redis Pub/Sub log + status events
└── s3-reverse-proxy/    # Subdomain-based S3 reverse proxy
    └── index.js
```

## Prerequisites

- Node.js 20+
- Redis (local or managed)
- AWS account with an S3 bucket
- (Optional) Docker

## Environment Variables

### api-server

| Variable       | Default                  | Description                            |
|----------------|--------------------------|----------------------------------------|
| `PORT`         | `3001`                   | HTTP port                              |
| `REDIS_URL`    | `redis://localhost:6379` | Redis connection string                |
| `FRONTEND_URL` | `http://localhost:5173`  | Allowed CORS origin                    |
| `BASE_DOMAIN`  | `localhost:8080`         | Domain used to build the project URL   |

### build-server

Copy `build-server/.env.sample` to `build-server/.env` and fill in:

| Variable                  | Description                              |
|---------------------------|------------------------------------------|
| `REDIS_URL`               | Redis connection string                  |
| `AWS_REGION`              | S3 bucket region (e.g. `us-east-1`)     |
| `AWS_ACCESS_KEY_ID`       | Local dev only — use IAM role in ECS     |
| `AWS_SECRET_ACCESS_KEY`   | Local dev only — use IAM role in ECS     |
| `S3_BUCKET`               | Target S3 bucket name                    |
| `WORKER_CONCURRENCY`      | Parallel builds (default: `2`)           |

### s3-reverse-proxy

Set `Base_path` in `s3-reverse-proxy/index.js` to your S3 bucket base URL (e.g. `https://your-bucket.s3.amazonaws.com`).

## Running Locally

```bash
# 1. Start Redis
docker run -p 6379:6379 redis:alpine

# 2. api-server
cd api-server
npm install
cp .env.sample .env   # edit as needed
node src/index.js

# 3. build-server
cd build-server
npm install
cp .env.sample .env   # add AWS creds + S3 bucket
node src/index.js

# 4. s3-reverse-proxy
cd s3-reverse-proxy
npm install
node index.js
```

## API Reference

### `POST /projects`

Queue a new build.

**Request body**
```json
{ "git_url": "https://github.com/user/repo" }
```

**Response `201`**
```json
{
  "projectId": "uuid",
  "status": "queued",
  "url": "http://<projectId>.yourdomain.com"
}
```

---

### `GET /projects`

List all projects (newest first).

---

### `GET /projects/:id/status`

Get the current build status of a project.

**Response**
```json
{
  "projectId": "uuid",
  "status": "building",
  "url": "http://<projectId>.yourdomain.com"
}
```

Status values: `queued` → `building` → `success` | `failed`

---

### `GET /projects/:id/logs`

Stream build logs as Server-Sent Events.

```
event: log
data: {"line": "npm install ..."}

event: status
data: {"status": "success"}
```

The connection closes automatically when the build reaches a terminal state.

## Deploying to AWS

The build-server is designed to run as an ECS task:

- Set `ECS_TASK_MODE=true` — the worker processes one job then exits, and ECS re-launches it for the next build.
- Attach an IAM Task Role with `s3:PutObject` on your bucket — no access keys needed in production.
- The Dockerfile uses a two-stage build: deps install in one stage, only the production `node_modules` and `src/` are copied into the final image.

## Known Limitations

- The in-memory project store in `api-server` resets on restart. Replace `src/lib/store.js` with a Postgres-backed implementation for persistence.
- Only GitHub HTTPS URLs are supported (`https://github.com/user/repo`).
- Build output must land in a `dist/` directory (auto-detected from `package.json`, falls back to `dist/`).

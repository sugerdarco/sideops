# Sideops

A self-hosted deployment platform that lets you ship any GitHub repo to a public URL in seconds. Push your code, get a link — no configuration required.

## How It Works

Sideops is built around four independent services that talk through Redis:

```
         Frontend (React + Vite)
              :5173
                │
                ▼
           api-server  ──(BullMQ job)──▶  build-server
            :3001                              │
                │                         clone → build → upload to S3
                │◀───── Redis Pub/Sub ─────────┘
                │        (logs + status)
                ▼
         s3-reverse-proxy
            :8080
            Routes <projectId>.yourdomain.com → S3 bucket path
```

1. **frontend** is a React + Vite single-page app where users paste a GitHub URL, trigger builds, and watch live logs via SSE.
2. **api-server** accepts a GitHub URL, queues a build job, and streams live logs back to the browser over SSE.
3. **build-server** pulls the repo, detects the package manager, runs the build, and uploads the output folder to S3 under `/<projectId>/dist/`.
4. **s3-reverse-proxy** sits in front of S3 and routes requests by subdomain — `abc123.yourdomain.com` proxies to `s3://your-bucket/abc123/dist/`.

## Project Structure

```
sideops/
├── api-server/              # REST API + SSE log streaming
│   └── src/
│       ├── index.js         # Express app entry point
│       ├── routes/
│       │   └── projects.js  # /projects routes
│       └── lib/
│           ├── queue.js     # BullMQ queue wrapper
│           ├── redis.js     # Redis connection helpers
│           └── store.js     # In-memory project store
├── build-server/            # BullMQ worker: clone → build → upload
│   └── src/
│       ├── index.js         # Worker entry point
│       ├── builder.js       # git clone + npm/pnpm/yarn build
│       ├── uploader.js      # S3 streaming upload
│       └── publisher.js     # Redis Pub/Sub log + status events
├── frontend/                # React + Vite UI
│   ├── src/
│   │   ├── App.jsx          # Main application component
│   │   ├── main.jsx         # Vite entry point
│   │   ├── components/      # LogViewer, StatusBadge
│   │   ├── hooks/           # useBuild hook
│   │   └── lib/             # API client (fetch + EventSource)
│   ├── nginx.conf           # Production nginx config
│   └── vite.config.js
├── s3-reverse-proxy/        # Subdomain-based S3 reverse proxy
│   └── index.js
├── infra/                   # AWS deployment helpers
│   ├── ecs-task-definition.json
│   └── iam-policies.txt
├── quick-test-everything.sh # One-command local dev setup script
└── quick-start.md           # Step-by-step setup guide
```

## Prerequisites

- Node.js 20+
- Redis (local or managed)
- S3-compatible object storage (AWS S3, MinIO, Cloudflare R2)
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

| Variable                  | Default                  | Description                                      |
|---------------------------|--------------------------|--------------------------------------------------|
| `REDIS_URL`               | `redis://localhost:6379` | Redis connection string                          |
| `AWS_REGION`              | `us-east-1`             | S3 bucket region                                 |
| `AWS_ACCESS_KEY_ID`       |                          | Local dev only — use IAM role in ECS             |
| `AWS_SECRET_ACCESS_KEY`   |                          | Local dev only — use IAM role in ECS             |
| `S3_BUCKET`               |                          | Target S3 bucket name                            |
| `S3_ENDPOINT`             |                          | Custom S3 endpoint (for MinIO, R2, etc.)         |
| `S3_FORCE_PATH_STYLE`     | `false`                  | Set `true` for MinIO / path-style endpoints      |
| `WORKER_CONCURRENCY`      | `2`                      | Parallel builds (local worker mode)              |
| `ECS_TASK_MODE`           | `false`                  | Set `true` on ECS — process one job then exit    |

### s3-reverse-proxy

Copy `s3-reverse-proxy/.env.sample` to `s3-reverse-proxy/.env` and fill in:

| Variable       | Default | Description                                             |
|----------------|---------|---------------------------------------------------------|
| `S3_BASE_URL`  |         | Full base URL to your storage (see examples below)      |
| `PORT`         | `8080`  | HTTP port                                               |

`S3_BASE_URL` examples:
- **MinIO**: `http://localhost:9000/sideops`
- **AWS S3**: `https://<bucket>.s3.<region>.amazonaws.com`
- **Cloudflare R2**: `https://<accountid>.r2.cloudflarestorage.com/<bucket>`

### frontend

Copy `frontend/.env.example` to `frontend/.env`:

| Variable           | Default                  | Description                        |
|--------------------|--------------------------|------------------------------------|
| `VITE_API_URL`     | `http://localhost:3001`  | API server URL                     |
| `VITE_BASE_DOMAIN` | `localhost:8080`         | Domain used to build deployed URLs |

## Running Locally

```bash
# 1. Start Redis
docker run -p 6379:6379 redis:alpine

# 2. api-server (port 3001)
cd api-server
npm install
cp .env.sample .env   # edit as needed
npm run dev            # uses --watch for auto-reload

# 3. build-server (BullMQ worker)
cd build-server
npm install
cp .env.sample .env   # add S3 config (see env table above)
npm run dev

# 4. s3-reverse-proxy (port 8080)
cd s3-reverse-proxy
npm install
cp .env.sample .env   # set S3_BASE_URL
npm run dev

# 5. frontend (port 5173)
cd frontend
npm install
cp .env.example .env
npm run dev
```

### Quick Start Script

For a fully automated local setup (Redis + MinIO + all services), use the included script:

```bash
./quick-test-everything.sh --storage minio --redis local
```

See [quick-start.md](quick-start.md) for detailed setup instructions including MinIO and AWS deployment.

## API Reference

### `GET /health`

Health check endpoint.

**Response `200`**
```json
{ "ok": true, "ts": 1717680000000 }
```

---

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

See [quick-start.md](quick-start.md) for full AWS ECS Fargate deployment steps.

## Known Limitations

- The in-memory project store in `api-server` resets on restart. Replace `src/lib/store.js` with a Postgres-backed implementation for persistence.
- Only GitHub HTTPS URLs are supported (`https://github.com/user/repo`).
- Build output is auto-detected from these directories (first match wins): `dist`, `out`, `build`, `next`, `public`.

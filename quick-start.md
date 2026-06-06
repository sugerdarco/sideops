# Quick Start Guide

## 🚀 Running Locally

### Prerequisites
- **Node.js 20+**
- **Redis** (local or managed)
- **Object storage** (any S3-compatible provider)
   - **AWS S3** (production) or
   - **MinIO** (local dev — no AWS account needed)

### One-Command Setup

Use the included script to start everything automatically:

```bash
# MinIO + local Redis (no AWS account needed)
./quick-test-everything.sh --storage minio --redis local

# AWS S3 + external Redis
./quick-test-everything.sh --storage aws --redis url --redis-url redis://my-redis:6379 \
  --aws-access-key AKIAxxx --aws-secret-key xxx --aws-bucket my-bucket

# Stop everything
./quick-test-everything.sh --stop
```

Run `./quick-test-everything.sh --help` for all options.

---

### Manual Setup

#### Optional — Start MinIO (no AWS account needed)
```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```
Then create a bucket named `sideops` at http://localhost:9001 (credentials: `minioadmin` / `minioadmin`).

#### Step 1 — Start Redis
```bash
docker run -p 6379:6379 redis:alpine
```

#### Step 2 — Start the API Server (port 3001)
```bash
cd api-server
npm install
cp .env.sample .env   # edit as needed
npm run dev            # uses --watch for auto-reload
```

#### Step 3 — Start the Build Server (BullMQ worker)
```bash
cd build-server
npm install
cp .env.sample .env

# For MinIO (local dev):
#   S3_ENDPOINT=http://localhost:9000
#   S3_FORCE_PATH_STYLE=true
#   S3_BUCKET=sideops
#   AWS_ACCESS_KEY_ID=minioadmin
#   AWS_SECRET_ACCESS_KEY=minioadmin
#
# For AWS S3 (production):
#   S3_BUCKET=your-bucket
#   AWS_ACCESS_KEY_ID=your-key
#   AWS_SECRET_ACCESS_KEY=your-secret

npm run dev
```

#### Step 4 — Start the S3 Reverse Proxy (port 8080)
```bash
cd s3-reverse-proxy
npm install
cp .env.sample .env

# Set S3_BASE_URL based on your storage:
#   MinIO:  http://localhost:9000/sideops
#   AWS:    https://your-bucket.s3.us-east-1.amazonaws.com
#   R2:     https://<accountid>.r2.cloudflarestorage.com/<bucket>

npm run dev
```

#### Step 5 — Start the Frontend (port 5173)
```bash
cd frontend
npm install
cp .env.example .env   # contains VITE_API_URL and VITE_BASE_DOMAIN
npm run dev
```

### 🐳 Or run everything with Docker
Each service has its own Dockerfile:
```bash
cd api-server && docker build -t sideops-api .
cd build-server && docker build -t sideops-build .
cd frontend && docker build -t sideops-frontend .
```

---

## ☁️ Deploying to AWS (ECS Fargate)

### Architecture Overview
```
Frontend (nginx container) → ALB → api-server (ECS)
                                       ↓ BullMQ → Redis
                                       ↓
                              build-server (ECS Fargate task)
                              → clones repo → builds → uploads to S3
                              
s3-reverse-proxy (ECS/EC2) → routes *.yourdomain.com → S3 bucket
```

### Step 1 — S3 Bucket
```bash
# Create bucket and block public access (proxy handles serving)
aws s3api create-bucket --bucket <S3_BUCKET_NAME> --region us-east-1
aws s3api put-public-access-block \
  --bucket <S3_BUCKET_NAME> \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### Step 2 — ECR Repositories
Push your Docker images to ECR:
```bash
aws ecr create-repository --repository-name sideops-build-worker
# Login, tag, and push the build-server image
```

### Step 3 — Redis
Use **Amazon ElastiCache** (Redis) or **ElastiCache Serverless** as your managed Redis.

### Step 4 — IAM Roles
Create these IAM policies (from `infra/iam-policies.txt`):

| Role | Purpose | Key Permissions |
|------|---------|-----------------|
| **sideops-ecs-execution-role** | Fargate pulls images + secrets | `AmazonECSTaskExecutionRolePolicy` + `secretsmanager:GetSecretValue` |
| **sideops-build-task-role** | Build worker writes to S3 | `s3:PutObject`, `s3:PutObjectAcl`, `s3:AbortMultipartUpload` |
| **Reverse proxy role** | Reads from S3 | `s3:GetObject`, `s3:HeadObject`, `s3:ListBucket` |

### Step 5 — Secrets Manager
Store your Redis URL:
```bash
aws secretsmanager create-secret \
  --name sideops/redis-url \
  --secret-string "rediss://your-elasticache-endpoint:6379"
```

### Step 6 — Register the ECS Task Definition
```bash
# Update infra/ecs-task-definition.json with your ECR image URIs and VPC config
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs-task-definition.json
```

### Step 7 — Create ECS Cluster
```bash
aws ecs create-cluster --cluster-name sideops
```

### Step 8 — Build Server — ECS Fargate Task
When deploying the build-server on ECS, set `ECS_TASK_MODE=true`. The worker processes one job then exits — ECS does not restart it automatically. Use `RunTask` per build job:
```bash
aws ecs run-task \
  --cluster sideops \
  --task-definition sideops-build-worker \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}"
```

### Step 9 — Frontend on ECS/ALB
Deploy the frontend nginx container behind an **Application Load Balancer** with:
- SSL termination (ACM certificate)
- `VITE_API_URL` env var pointing to your API server's ALB DNS
- `VITE_BASE_DOMAIN` env var set to your custom domain

### Step 10 — S3 Reverse Proxy
Deploy on EC2 or ECS with a wildcard DNS record (`*.yourdomain.com` → proxy IP) so that `<projectId>.yourdomain.com` routes to the correct S3 path.

# Stage 1: install deps 
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

# Stage 2: runtime 
FROM node:20-alpine
WORKDIR /app

# git for cloning; pnpm + yarn so the builder can use any package manager
RUN apk add --no-cache git && \
    npm install -g pnpm yarn --prefer-offline

COPY --from=deps /app/node_modules ./node_modules
COPY package.json .
COPY src ./src

ENV NODE_ENV=production

# AWS credentials come from the ECS IAM Task Role at runtime — never baked in.
# For local dev, pass AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY via env file.

CMD ["node", "src/index.js"]

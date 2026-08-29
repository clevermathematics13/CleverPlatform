# Build context must be platform/, not platform/worker/ -- same convention
# as cv-service/Dockerfile, and for the same reason: this worker imports
# lib/na-scanning.ts and lib/na-assessment.ts directly (see README.md), so
# those need to be in the build context too.
#
#   cd platform
#   docker build -f worker/Dockerfile -t cleverplatform-worker .

FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY lib ./lib
COPY worker ./worker

CMD ["npx", "tsx", "worker/index.ts"]

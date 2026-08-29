# Build context must be platform/, not platform/worker/ -- same convention
# as cv-service/Dockerfile, and for the same reason: this worker imports
# lib/na-scanning.ts and lib/na-assessment.ts directly (see README.md), so
# those need to be in the build context too.
#
#   cd platform
#   docker build -f worker/Dockerfile -t cleverplatform-worker .

FROM node:24-slim

WORKDIR /app

# Cache-bust marker: a prior Railway build reused a stale cached layer here
# that belonged to an unrelated project (its npm ci error listed @nestjs/*,
# @swc/cli, and binary-downloader packages -- none of which appear anywhere
# in this repo's package.json). `npm ci` against the real committed
# package.json/package-lock.json installs cleanly (verified locally). This
# comment exists purely to change this layer's cache key so a bad cached
# COPY can't be reused again; safe to remove once confirmed fixed.
COPY package.json package-lock.json ./
RUN npm ci

COPY lib ./lib
COPY worker ./worker

CMD ["npx", "tsx", "worker/index.ts"]

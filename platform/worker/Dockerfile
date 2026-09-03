# Build context must be platform/, not platform/worker/ -- same convention
# as cv-service/Dockerfile, and for the same reason: this worker imports
# lib/na-scanning.ts and lib/na-assessment.ts directly (see README.md), so
# those need to be in the build context too.
#
#   cd platform
#   docker build -f worker/Dockerfile -t cleverplatform-worker .

FROM node:24-slim

WORKDIR /app

# .npmrc matters here: it sets legacy-peer-deps=true, which is what lets
# `npm ci` succeed at all. @workflow/nest (a transitive optional adapter
# pulled in by the `workflow` dependency) declares NON-optional peer
# dependencies on @nestjs/common, @nestjs/core, @swc/cli, @swc/core that
# this project doesn't actually install -- without legacy-peer-deps, npm's
# strict peer-dependency validation fails `npm ci` outright over this
# (real failure hit here: Railway built without .npmrc in the image at all,
# since only package.json/package-lock.json were copied, and got exactly
# that EUSAGE error even though the identical files install cleanly
# anywhere .npmrc is present alongside them).
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY lib ./lib
COPY worker ./worker

# Load-bearing, not optional. lib/na-assessment.ts reads
# feedback_voice/na_student_feedback_voice.md at MODULE INIT (see
# buildAssessmentSystemPrompt) and throws if it is missing, and
# worker/assess-submit.ts imports that module -- so without this COPY the
# worker throws on import, never reaches its poll loop, and na_scan_batches
# rows sit in 'queued' forever. WORKDIR is /app, which is the process.cwd()
# those paths resolve against.
#
# `npm run worker:dev` cannot catch a missing COPY here: it runs with cwd
# platform/, where the file exists regardless. Only building the image can.
COPY feedback_voice ./feedback_voice

# Deliberate insurance rather than dead weight: lib/ai-grading.ts loads
# grading_policies/ the same way, and is one stray import away from being
# reachable from this worker with the identical non-obvious crashloop.
COPY grading_policies ./grading_policies

CMD ["npx", "tsx", "worker/index.ts"]

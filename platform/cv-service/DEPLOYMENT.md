# CV Service — Deployment Runbook

The Python CV service (`platform/cv-service/`) is **already written and verified working**.
Nothing needs coding. This is purely a deployment task.

## What it is

A FastAPI service exposing two endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe — returns `{"status":"ok"}` |
| `POST /extract` | Deterministic graph extraction from an image |

`/api/graph-lab-cv/route.ts` in the Next.js app already proxies to it. It expects
`GRAPH_LAB_CV_SERVICE_URL` and optionally `CV_SERVICE_SECRET`.

## Why it's needed right now

Graph Lab's CV extraction is **currently broken in production**. Vercel's Node runtime
has no Python, so this fires on every call:

```
{"error": "GRAPH_LAB_CV_SERVICE_URL is not configured"}  // HTTP 503
```

Deploying the service fixes that feature. It also gives the NA scan pipeline a home for
its page-identity fallback (ORB) and anchor extraction (PyMuPDF).

## Verified before deployment

Tested locally in a clean Python 3.12 container:

- All pinned deps in `requirements.txt` resolve with no conflicts
- `from cv_graph_extract import extract_graph_cv` — the exact import `main.py` does — loads
- Real extraction: drew a synthetic `y = x^2/4` parabola, extractor recovered
  `0.200928*x^2 + 0.00575159` and independently detected grid lines and axis ranges
- Service boots under uvicorn exactly as the Dockerfile's `CMD` specifies
- `GET /health` -> 200 `{"status":"ok"}`
- `POST /extract` wrong secret -> 401; empty `images` -> 400; real image -> 200 with correct
  response shape (`graphSpec`, `graphMeta`, `warnings`, `feedback`, `metadata`) and
  request tracing (`requestId`, `upstreamInputSha256`) propagating correctly
- `opencv-python-headless` + `pymupdf` install alongside the numpy 2.2.6 pin, and the
  graph extractor produces identical output with cv2 loaded (no regression)

## Important: Docker build context

The `Dockerfile` copies from the **parent** directory:

```dockerfile
COPY cv-service/requirements.txt /app/cv-service/requirements.txt
COPY scripts /app/scripts
COPY cv-service/main.py /app/cv-service/main.py
```

So the build context must be `platform/`, **not** `platform/cv-service/`:

```bash
cd platform
docker build -f cv-service/Dockerfile -t cleverplatform-cv .
```

Building from inside `cv-service/` will fail — `scripts/` won't be in scope.
This matters because `main.py` imports `cv_graph_extract` from `../scripts/`.

## Local smoke test before paying for hosting

```bash
cd platform
docker build -f cv-service/Dockerfile -t cleverplatform-cv .
docker run --rm -p 8080:8080 -e CV_SERVICE_SECRET=localtest cleverplatform-cv

# in another terminal
curl http://localhost:8080/health
# -> {"status":"ok"}
```

## Hosting options

Any container host works. The service is small and stateless.

| Host | Notes |
|---|---|
| **Fly.io** | `fly launch --dockerfile cv-service/Dockerfile` from `platform/`. Scale-to-zero available, which suits bursty use. |
| **Railway** | Point at the repo, set root directory to `platform/`, Dockerfile path `cv-service/Dockerfile`. |
| **Render** | Web Service -> Docker -> same root/Dockerfile split. |
| **Google Cloud Run** | Scale-to-zero, and you already have a GCP project (`cleverplatform`). Good fit if you want to consolidate. |

**Sizing:** 512MB RAM is enough for graph extraction. Bump to 1GB if you later route NA
page-identity (ORB on full-page images) through it.

**Cost:** roughly $5-10/month always-on; less with scale-to-zero, at the price of cold starts.
Note the Next.js proxy has a **28-second abort timeout**, so a slow cold start can surface as
a 502. If you pick scale-to-zero, test a cold request before relying on it.

## Wiring it to Vercel

Once deployed, set in Vercel project env vars (production):

```
GRAPH_LAB_CV_SERVICE_URL = https://your-service-host.example.com
CV_SERVICE_SECRET        = <a long random string>
```

Set the **same** `CV_SERVICE_SECRET` on the CV service itself. If it's unset on the service,
auth is skipped entirely and anyone who finds the URL can use it — set it.

The proxy tolerates either form: bare host or a full `.../extract` URL. It appends `/extract`
if absent.

Redeploy Vercel after setting the vars (env changes don't apply to existing deployments).

## Verifying it's live

1. `curl https://your-service-host/health` -> `{"status":"ok"}`
2. In the app, open Graph Lab and run a real extraction.
3. Confirm the response's `metadata.proxy` block shows `status: 200` and a sane `durationMs`.

If you get 502 from `/api/graph-lab-cv`, the proxy reached nothing — check the URL and that
the service is actually up. If 401, the secrets don't match.

## Security note

`/api/graph-lab-cv` is already teacher-gated (`getApiTeacher`), so the Next.js side is
protected. The CV service itself is only protected by `CV_SERVICE_SECRET` — it will be
publicly reachable on the internet. Set the secret, and prefer a host that lets you restrict
ingress if that's easy.

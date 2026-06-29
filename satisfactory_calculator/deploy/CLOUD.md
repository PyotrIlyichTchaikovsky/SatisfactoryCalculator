# Cloud Deployment

This repository is prepared for a split frontend/backend deployment:

- GitHub stores the code and runs CI/CD workflows.
- Cloudflare Pages hosts the static frontend from `dist/frontend`.
- Google Cloud Run hosts the Python ASGI API.
- Artifact Registry stores the backend Docker image.
- Cloud Logging collects backend stdout/stderr automatically from Cloud Run.
- Sentry can monitor frontend JavaScript errors and backend Python exceptions.
- AdSense/Search Console are enabled through generated static files plus console-side setup.

## Build Locally

Build the Cloudflare Pages artifact:

```powershell
python .\scripts\build_frontend.py
```

Build and run the Cloud Run image locally:

```powershell
docker build -t production-planner-api .
docker run --rm -p 8080:8080 `
  -e PORT=8080 `
  -e PLANNER_ALLOWED_ORIGINS=http://localhost:8788 `
  production-planner-api
```

Health check:

```text
GET http://127.0.0.1:8080/api/health
```

## GitHub Configuration

Repository variables:

```text
GCP_PROJECT_ID
GCP_REGION
ARTIFACT_REGISTRY_REPOSITORY
CLOUD_RUN_SERVICE
PLANNER_ALLOWED_ORIGINS
PUBLIC_SITE_URL
PLANNER_API_BASE_URL
CLOUDFLARE_PAGES_PROJECT
SENTRY_FRONTEND_DSN
SENTRY_BROWSER_SCRIPT_URL
ADSENSE_CLIENT
ADSENSE_ENABLED
```

Repository secrets:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_SERVICE_ACCOUNT
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
SENTRY_DSN
```

The two deployment workflows are manual:

- `.github/workflows/backend-cloud-run.yml`
- `.github/workflows/frontend-cloudflare-pages.yml`

Deploy the backend first, copy the Cloud Run URL into `PLANNER_API_BASE_URL`, set the Cloudflare Pages origin in `PLANNER_ALLOWED_ORIGINS`, then deploy the frontend.

## Google Cloud Setup

Enable these APIs:

```text
run.googleapis.com
artifactregistry.googleapis.com
iamcredentials.googleapis.com
sts.googleapis.com
```

Create a Docker Artifact Registry repository in `GCP_REGION`, then grant the GitHub deployment service account:

```text
roles/artifactregistry.writer
roles/run.admin
roles/iam.serviceAccountUser
```

Cloud Run should allow unauthenticated requests for the public API. Restrict CORS with `PLANNER_ALLOWED_ORIGINS`, for example:

```text
PLANNER_ALLOWED_ORIGINS=https://www.example.com,https://production-planner.pages.dev
```

Create a Billing Budget in the Google Cloud Billing console for the project. This is a console/IaC control, not an application code setting.

## Cloudflare Setup

Create a Cloudflare Pages project connected to GitHub. The workflow uploads `dist/frontend`, so no Cloudflare-side build command is required when using the GitHub Action.

DNS should point the production domain to the Pages project. After the domain is live, set:

```text
PUBLIC_SITE_URL=https://www.example.com
PLANNER_API_BASE_URL=https://<cloud-run-service-url>
```

The build writes `_headers`, `robots.txt`, `sitemap.xml`, optional `ads.txt`, and `planner_config.js`.

## Sentry

Backend monitoring uses `SENTRY_DSN` on Cloud Run. Frontend monitoring uses `SENTRY_FRONTEND_DSN` and requires `SENTRY_BROWSER_SCRIPT_URL` so the browser SDK is loaded before `production_planner.js`.

Use `SENTRY_RELEASE=${{ github.sha }}` from the workflows to connect events to deploys.

## AdSense and Search Console

Set `ADSENSE_CLIENT=ca-pub-...` and `ADSENSE_ENABLED=true` only after the site is approved. The frontend build injects the AdSense loader and generates `ads.txt`.

Verify the domain in Google Search Console, preferably with a DNS TXT record in Cloudflare. Submit:

```text
https://www.example.com/sitemap.xml
```

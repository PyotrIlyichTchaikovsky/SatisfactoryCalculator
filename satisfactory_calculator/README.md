# Satisfactory Calculator

## Directory Layout

- `data_exporter/`: code, config, and raw snapshots for exporting game data and rebuilding the planner workbook.
- `recipe_web/`: Python web service, calculation module, and static assets for the production planner.

## Local Development

Install Python dependencies:

```powershell
py -m pip install -r requirements.txt
```

Export the raw game data snapshot and rebuild the planner data workbook:

```powershell
py .\data_exporter\data_exporter.py
```

Start the planner web service:

```powershell
py .\recipe_web\production_planner_server.py
```

Open the planner page in a browser:

```text
http://127.0.0.1:8000/
```

The local server is meant for development and smoke testing. Do not expose it
directly to the public internet.

## Production Deployment

Run the production API with Uvicorn, and put Caddy or Nginx in front of it for
HTTPS, static files, compression, and public caching.

Example API process:

```powershell
cd .\recipe_web
python -m uvicorn production_planner_app:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers
```

Example reverse proxy and systemd templates are in `deploy/`.

Health check:

```text
GET /api/health
```

Production environment knobs:

```text
PLANNER_MAX_BODY_BYTES=65536
PLANNER_MAX_CONCURRENT_PLANS=2
PLANNER_PLAN_TIMEOUT_SECONDS=15
PLANNER_PLAN_QUEUE_TIMEOUT_SECONDS=0.25
PLANNER_PLAN_CACHE_TTL_SECONDS=900
PLANNER_PLAN_CACHE_MAX_ENTRIES=256
PLANNER_LOG_LEVEL=INFO
PLANNER_LOG_FILE=/var/log/production-planner/app.log
```

The production API intentionally returns generic 500 errors to users while
logging details server-side. Static assets should be served by the reverse proxy
with caching; `/api/*` should stay uncached.

Operational endpoints:

```text
GET /api/health   # uptime and basic loaded-data status
GET /api/metrics  # lightweight in-memory request, plan, error, and cache counters
```

The metrics endpoint is intentionally simple and process-local. If multiple
workers or servers are used later, aggregate these counters in the reverse proxy
or an external monitoring service.

`/api/plan` uses an in-memory TTL/LRU cache keyed by targets and enabled recipe
IDs. The cache is per process and is cleared on restart.

## Ads and Privacy Notes

Keep ad scripts isolated from planner logic. Before enabling ads on the public
site:

- update the Content-Security-Policy in `deploy/Caddyfile.example` with the
  exact ad network domains;
- add a privacy policy page that explains analytics, ads, cookies, and local
  storage usage;
- avoid storing personal data in planner requests or logs;
- check the ad network's consent requirements for the regions you intend to
  support.

## Testing

Run the same checks used by CI:

```powershell
python -m py_compile `
  .\recipe_web\production_planner_core.py `
  .\recipe_web\production_planner_server.py `
  .\recipe_web\production_planner_app.py

python -m unittest discover -s .\tests -v

node --check .\recipe_web\production_planner.js
```

The regression tests cover core planning, Rocket Fuel production, missing recipe
expansion, API input limits, static file blocking, cache headers, health checks,
metrics, and plan caching.

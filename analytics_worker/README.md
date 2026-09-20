# Usage analytics collector

This Worker accepts a fixed list of anonymous product events and writes them to
Cloudflare Workers Analytics Engine. It never writes request IPs, raw user-agent
strings, planner rates, saved plans, graph layouts, or arbitrary user text.

Datasets are separated by environment:

- `factor_tools_usage_staging`
- `factor_tools_usage_production`

`double1 = 1` marks synthetic/test traffic. Every production query must include
`double1 = 0`. `index1` is a random browser identifier that rotates daily, so it
can estimate daily active browsers without correlating a browser across days.

The remaining columns are:

| Column | Value |
|---|---|
| blob1 | event name |
| blob2 | environment |
| blob3 | release commit |
| blob4 | locale |
| blob5 | viewport bucket |
| blob6..blob11 | whitelisted event dimensions |
| double2 | duration milliseconds |
| double3 | target count |
| double4 | recipe count |
| double5 | enabled recipe count |
| double6 | result row count |

Example production queries:

```sql
SELECT COUNT(DISTINCT index1) AS daily_active_browsers
FROM factor_tools_usage_production
WHERE timestamp >= NOW() - INTERVAL '1' DAY AND double1 = 0;

SELECT blob1 AS event_name, SUM(_sample_interval) AS event_count
FROM factor_tools_usage_production
WHERE timestamp >= NOW() - INTERVAL '7' DAY AND double1 = 0
GROUP BY event_name ORDER BY event_count DESC;
```

Deploy only after the frontend has passed local review. Use separate endpoints
for staging and production, then set each GitHub Environment variable named
`PLANNER_ANALYTICS_ENDPOINT` to its matching `/events` URL.

## Viewing custom statistics

The Worker includes a private dashboard at `/dashboard`. It shows active daily
browsers, visits, successful and failed calculations, daily trends, languages,
and counts for every tracked feature event. Every query contains `double1 = 0`,
so requests made in analytics test mode and automated browser tests are excluded.

Protect the dashboard with Cloudflare Access before using it. Configure these
Worker values separately for staging and production:

| Setting | Type | Purpose |
|---|---|---|
| `ANALYTICS_ACCOUNT_ID` | secret | Account containing Analytics Engine |
| `CF_ACCESS_TEAM_DOMAIN` | variable | For example `your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | variable | Access application audience tag |
| `ADMIN_EMAILS` | variable | Optional comma-separated dashboard email allowlist |
| `ANALYTICS_READ_TOKEN` | secret | API token limited to Analytics Engine read access |

Use a dedicated custom hostname such as `analytics.factor-tools.com`, add a
self-hosted Access application for `analytics.factor-tools.com/dashboard*`, and
allow only the owner's identity. The Worker validates the signed Access token
again before it serves either the page or its data API.

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

Deploy only after the frontend has passed local review. Staging and production
use separate collectors. The release workflow deploys the environment's Worker
first, reads the `workers.dev` URL reported by Wrangler, and supplies its
matching `/events` URL to the frontend build automatically. No GitHub
Environment variable is needed for the collector endpoint.

## Viewing custom statistics

The Worker includes an aggregate dashboard at `/dashboard`. It shows active daily
browsers, visits, successful and failed calculations, daily trends, languages,
and counts for every tracked feature event. Every query contains `double1 = 0`,
so requests made in analytics test mode and automated browser tests are excluded.
The page is public, but it exposes only these fixed aggregate queries. It never
returns visitor identifiers or accepts SQL from a request. Summary responses are
cached for five minutes to protect the Analytics Engine query allowance.

Configure these Worker values separately for staging and production:

| Setting | Type | Purpose |
|---|---|---|
| `ANALYTICS_ACCOUNT_ID` | secret | Account containing Analytics Engine |
| `ANALYTICS_READ_TOKEN` | secret | API token limited to Analytics Engine read access |

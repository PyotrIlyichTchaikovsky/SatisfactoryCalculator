# Cloud deployment

The planner uses GitHub Actions, two Cloudflare Pages projects and two Cloud Run services.

**Start with [the step-by-step release setup guide](RELEASE.md).** It replaces the previous independent frontend/backend workflows.

- `staging`: automatically deployed candidate, API smoke tests and real browser tests, then manual product acceptance.
- `production`: GitHub Environment approval, promotion of the same image digest and application commit, production checks, automatic recovery on failure.
- `.github/workflows/rollback.yml`: restore a previously verified version pair, or recover from the pre-deployment snapshot of an interrupted attempt.

Deployment is disabled until the repository variable `RELEASE_PIPELINE_ENABLED` is set to `true`. Configure the production approval rule and both environments before enabling it.

[BUG-reporting acceptance](MONITORING.md) remains a separate, deliberate check against the real staging or production deployment. Ordinary release tests do not manufacture production monitoring errors.

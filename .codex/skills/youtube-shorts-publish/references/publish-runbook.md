# YouTube publication runbook

1. Confirm target channel and authorization mode.
2. Validate render, media QA, title, description, audience setting, and privacy.
3. Resolve the idempotency key in the ledger and recent channel uploads.
4. Obtain approval at the public upload step when not covered by standing approval.
5. Upload once and persist the response immediately.
6. Poll processing with bounded retries; do not replace while status is unknown.
7. Verify the canonical publication and privacy.
8. Record 24h, 72h, and 7d checkpoints.

If credentials are missing or expired, preserve the ready request and ask for authentication. Never commit secrets.

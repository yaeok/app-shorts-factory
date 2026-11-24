---
name: shorts-factory
description: Orchestrate an app's Shorts workflow from discovery through planning, rendering, publishing, measurement, and evidence-based iteration. Use when the request spans multiple stages rather than one isolated video or upload.
---

# Shorts Factory

Turn an app and a growth objective into a traceable content operation. Keep app-specific facts, creative recipes, publication records, metrics, and learnings as data rather than hard-coding them into the renderer.

## Route the work

- Missing positioning, audience, assets, or desired direction: use `$shorts-intake`.
- Produce or revise a video and its metadata: use `$shorts-create`.
- Prepare or execute a YouTube Shorts upload: use `$youtube-shorts-publish`.
- Compare checkpoint metrics and choose the next controlled change: use `$shorts-pdca`.
- Promote proven learnings or instantiate another approved campaign: use `$shorts-growth-loop`.

Read [references/architecture.md](references/architecture.md) when creating a new workspace, changing workflow contracts, or diagnosing handoff failures between stages.

## Invariants

- Treat first-time downloads or the user's selected downstream conversion as the primary KPI; use views and engagement diagnostically.
- Keep observed, calculated, estimated, unavailable, and pending values distinct.
- Give every planned video a stable ID and every publication an idempotency key.
- Never publish, edit, delete, create an account, or change channel settings without authority for that external action.
- Do not let an automation rewrite skills or production templates from one result. Learning promotion is a reviewed, versioned change.
- A failed stage returns a durable record with the next safe action; it does not silently skip quality or approval gates.

---
name: youtube-shorts-publish
description: Prepare, approve, upload, verify, and record YouTube Shorts publications with duplicate prevention, processing checks, and safe recovery. Use only for YouTube publication work, not video creation.
---

# YouTube Shorts Publish

Accept only a QA-passed render, proposed metadata, target channel, and stable publication idempotency key. Read [references/publish-runbook.md](references/publish-runbook.md) before the first upload for a channel or when recovering a failed upload.

- Check the publication ledger and channel before uploading; never infer failure from a timeout alone.
- Require authority at the external publication step unless an explicit standing automation approval covers the exact channel and scope.
- Default new integrations to private or unlisted verification. Enable public uploads only after approval and a successful end-to-end test.
- Record video ID, URL, channel, privacy, timestamp, recipe/plan IDs, processing result, and exact metadata.
- Verify processing and visible privacy. A successful API response is insufficient.
- On uncertain failure, reconcile by idempotency key, title, and recent uploads before retrying.

Do not delete, edit, or replace an existing publication unless specifically requested and confirmed.

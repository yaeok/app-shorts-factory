# Workflow architecture

The repository separates six concerns:

1. `workspace.json`: app facts, brand, channels, KPI, assets, and authorization boundaries.
2. `recipes/*.json`: repeatable content families such as product demo, quiz, calculation, or number sequence.
3. `plans/*.json`: immutable video briefs created from a workspace and recipe.
4. `renders/` and `publish-queue/`: media QA output and idempotent publication requests.
5. `metrics/` and `reviews/`: checkpoint observations and PDCA decisions.
6. `learnings/`: evidence-backed candidates that may become recipe versions after review.

The renderer consumes a plan and local assets. Publishers consume only QA-passed renders and approved publication requests. Reviewers consume publication records and measured checkpoints. Learning promotion creates a new recipe version; it never mutates historical plans.

Product introductions may use a finite launch sequence. Quiz, calculation, number-sequence, or utility formats may use deterministic generators. Both use the same publication, measurement, and learning contracts.

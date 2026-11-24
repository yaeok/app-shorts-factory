# App Shorts Factory architecture

The repository is a workflow platform, not only a renderer.

```text
intake → workspace → recipe → plan → render/QA → approval → publish
                                                       ↓
learning ← promotion review ← PDCA ← checkpoint metrics ← ledger
```

## Isolation

Each app has its own workspace, assets, recipes, plans, publication ledger, metrics, and learnings. Credentials live outside Git and are never copied when a campaign is instantiated.

## Content families

- Finite: launch story, feature introduction, onboarding, release announcement.
- Repeatable: quiz, number sequence, calculation, daily tip, workflow demo, before/after.

Repeatable generators must validate domain truth independently. The rendering layer never becomes the authority for answers, claims, or eligibility.

## Automation levels

1. Draft: plan and render only.
2. Assisted: prepare a publication request and ask at the external action.
3. Standing: publish within an explicitly approved channel, cadence, privacy, and recipe scope.

Metrics collection and report generation may be automatic. Recipe promotion, new channels, account creation, credential changes, and destructive publication actions always remain reviewed.

## What changed

<!-- One or two sentences. What does this PR do, in the imperative? -->

## Why

<!-- The motivating problem or requirement. Link the issue or doc if there is one. -->

## Invariants and security

<!-- Required if this touches timing, scoring, RLS, auth, or the trust boundary.
     What invariant does this preserve or change? What could a hostile client do?
     Write "n/a" if genuinely not applicable. -->

## Database

<!-- Migration file(s), constraints added, RLS policies changed.
     Write "no schema change" if none. -->

## Tests

<!-- Exact commands run and key cases covered. Not "manual testing". -->

```
npm run lint
npm run typecheck
npm test
```

## Version skew

<!-- Required for any Edge Function or contract change once mobile ships.
     Is this additive and backward-compatible with client versions still in the field?
     If not, what gates it? Write "n/a" for client-only changes. -->

## Screenshots

<!-- For UI changes. Include a mobile viewport. -->

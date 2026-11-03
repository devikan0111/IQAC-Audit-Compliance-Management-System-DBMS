# Statistics and reviewer overview

The default landing page is Statistics. It helps reviewers identify pending work and open the relevant records. These are reporting features, not a claim of independently invented novelty.

## Role access

- Faculty: only their own faculty submissions. No department metrics, other faculty counts, department scores or department comparison.
- HOD: faculty submissions and department metrics in their department; their own department score. Review shortcuts target Submitted faculty records in an Active cycle.
- Auditor: all departments or one selected department. Review shortcuts target Verified faculty records and Submitted/Verified department metrics in an Active cycle.
- Admin: institution-wide or department-filtered oversight. Charts do not grant approval rights; Admin cannot approve submissions.

These restrictions are enforced in the API query builder, not just hidden in the interface. The existing Reports endpoint and dashboard score payload were updated to match Faculty privacy.

## Filters and navigation

Choose an audit cycle and record type (Faculty / Department / All). Auditors and Admins can additionally select a department. Faculty are fixed to their own records.

Counts and workload links open the appropriate register with cycle, department and status filters intact. Monthly chart links also filter by creation month. The register shows its active scope and a Clear filters action. Clicking a normal register navigation item starts a fresh unfiltered view within the authenticated user's permissions. Opening records still uses the existing evidence, history and review authorization checks.

The score chart opens the scorecard for the same cycle. Scores cover all eligible metrics and are not recalculated when the Records filter changes.

Statistics refresh on opening, on filter change, on returning to the page after a mutation, every 60 seconds while visible, and when the browser tab becomes visible. Refresh statistics performs a new read, not a score recalculation.

## Precise definitions

- Total: number of visible faculty submissions plus department metric rows for the selection. This mixes two record kinds, not unique papers, faculty headcounts or achievement ratings.
- Status cards: each record's current Draft, Submitted, Verified, Approved or Rejected status. These are disjoint counts, not cumulative workflow events.
- Pending: Submitted + Verified. Draft and Rejected are separate.
- Waiting for HOD: Faculty Submitted.
- Waiting for Auditor: Faculty Verified, Department Submitted and Department Verified.
- Ready for your review: pending groups for the current HOD/Auditor's permitted stage, only when the cycle is Active. Viewing a backlog in a Locked/Archived cycle does not permit reviewing it.
- Approval percentage: Approved / Total x 100, rounded to one decimal. Total includes Draft and Rejected. No records produces a dash, not 0%.
- Monthly activity: faculty record creation date (including Drafts). It is not first submission, approval or event date. Only months with records are listed. Department metrics have no creation timestamp and are excluded; Department-only selection omits this chart.
- Department score: existing Score_Aggregates snapshot out of 100. NULL means Not calculated; a real zero stays 0.00. An Auditor/Admin refreshes Active/Locked cycles through the scorecard. Project weights are not official accreditation scores.

One read-only repeatable-read MySQL snapshot supplies all aggregates for a response. Faculty and department rows are combined with UNION ALL rather than multiplied through a joined detail table. User-supplied filters are bound parameters.

## API

GET /api/statistics?cycle_id=1
Optional: &dept_id=1 and &kind=faculty, department or all.

Authenticated sessions are mandatory. Invalid filters return 400; out-of-scope requests return 403; missing cycles/departments return 404. The response contains filters, cycle, permitted department options, summary/counts, byKind, backlog/stage groups, monthly creation counts (or null), scores (or null) and generatedAt. Responses are no-store.

11_statistics_queries.sql contains administrator SQL equivalents for the default institution-wide view. It is a read-only demonstration file, not a migration and not an app authorization boundary.

## Seed demonstration

On the untouched cycle 1 seed:
- Total: 9 records (6 faculty + 3 department).
- Draft 0; Submitted 2; Verified 2; Approved 4; Rejected 1.
- Pending 4; approval percentage 44.4%.
- HOD workload: CSE 1, ECE 0, ME 0.
- Auditor workload: CSE 2, ECE 1, ME 0.
- Monthly faculty creations: January 2, February 2, March 2 (2026).
- Department scores after calculation: CSE 31.25, ECE 19.50, ME 0.00.
- Ravi's Faculty view: 2 records, Approved 1, Verified 1, pending 1.
- CSE HOD view: 6 records, pending 3.

Real submissions/reviews change these numbers. Do not reset the presentation database to recover sample totals.

## Verification and boundaries

Run npm test, npm run build, npm run test:sql and npm run test:demo. The latter two use disposable QA schemas; test:demo also uses a disposable Mongo database and local QA server. It no longer reinstalls objects in the real project DB before testing.

No SQL schema migration or new Mongo collection is needed for Statistics. The original eight core tables and three portal support tables remain. Score_Aggregates remains a stored snapshot table; replacing it with a view was discussed but is not implemented. Evidence reuse and individual/co-author scoring are proposals, not implemented features.

Charts use native HTML/CSS, include numeric labels and text explanations, and do not require a chart CDN or new package. Responsive and keyboard styles are included. Browser visual verification for this update could not run because the computer-use runtime failed to start; see VERIFICATION.txt for executed checks.
Record and scorecard drilldowns reload the latest dashboard data before opening, so an updated Statistics response does not lead into a stale cached register.

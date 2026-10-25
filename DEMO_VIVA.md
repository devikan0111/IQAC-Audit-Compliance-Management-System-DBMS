# 26 October: demo and viva

## Before leaving for the lab

1. Start the MySQL service normally.
2. In this project folder, run npm run demo in PowerShell and leave it open.
3. Open http://localhost:3000. The browser address must match APP_ORIGIN.
4. Sign in as auditor@pes.edu using the seed demo password Pass@123.
5. Open Reports and confirm all three reports load.
6. Save the three CSV exports as a backup.
7. Bring your ER diagram: show at least five tables, PKs, FKs and cardinalities.
8. Keep .env.local private. Do not put it in Git, screenshots or your submission.

If dependencies/build are missing: npm ci, then npm run build.
Initial MySQL setup: npm run db:bootstrap. It preserves populated project tables
and refuses partial schemas. It does not reset other databases.
Local MongoDB runtime/data are ignored by Git in .runtime/ and .data/.

## Five-minute demonstration

### Explain the problem (30 seconds)

Faculty and department evidence is scattered. Duplicate claims, missing documents,
unclear review status and manual scoring make audits difficult. This project
organizes evidence and review, with a status history and department reports.

### Show the ER diagram (45 seconds)

Eight core MySQL tables: Departments, User_Auth_Roles, Audit_Cycles,
Criteria_Metrics_Master, Faculty_Submissions, Department_Metrics,
Verification_Logs and Score_Aggregates.

Explain department-to-users, faculty-to-submissions, criterion-to-submissions and
cycle-to-submissions one-to-many relationships. Criteria optionally reference a
parent criterion. Each verification log targets exactly one faculty submission OR
department metric. Score_Aggregates is unique by (cycle, department).
Portal_Sessions, Portal_Login_Attempts and Evidence_Outbox are support tables.

### Show the reports (90 seconds)

For AQAR 2025-26 / cycle 1 on the untouched supplied seed:
- Approved faculty submissions: CSE 1, ECE 2, Mechanical 0.
- Pending reviews: CSE 3, ECE 1, Mechanical 0.
- Weighted scores: CSE 31.25, ECE 19.50, Mechanical 0.00.

Mechanical still appears because LEFT JOIN starts from Departments.
A missing score says Not calculated; it is different from an actual zero.
Switch cycle and demonstrate Download CSV. Raw awarded points differ from weighted
department scores. Show 10_reports.sql when asked for the underlying queries.

### Show SQL and MongoDB together (60 seconds)

Open a submission. MySQL holds owner, criterion, cycle, status and awarded score.
MongoDB holds variable details such as journal/indexing, patent status, authors,
equipment or budget heads. MongoDB ObjectId is stored as mongo_doc_id in SQL.

Compass connection: mongodb://127.0.0.1:27017, database iqac_nosql.
Show faculty_evidence and department_evidence and a type-specific details object.
Compass is a viewer/client; the MongoDB server must be running separately.

### Show a role restriction (45 seconds)

Faculty can edit their own Draft/Rejected records. The department HOD verifies
faculty work; the Auditor approves it. Admin is a distinct role and cannot approve.
Demonstrating new approvals changes report totals: explain that change rather than
claiming the untouched seed totals still apply.

## Viva answers to understand in your own words

**Why MySQL?** Structured relationships, constraints, joins and transactional
workflow fit relational data.

**Why MongoDB?** Evidence differs by type and contains arrays. A paper has indexing
fields while a patent has filing/status fields. SQL remains workflow/scoring truth.
SQL JSON columns would be another design option; explain the tradeoff.

**Is MongoDB schema-free?** This project uses required fields, schema validation
and oneOf branches. Flexible structure does not mean arbitrary invalid documents.

**Normalization?** Departments, users, cycles and metric definitions have their
own tables rather than being repeated in every submission. Explain functional
dependencies before claiming a formal normal form.

**PK, FK, UNIQUE?** PK identifies a row. FK requires a referenced row. UNIQUE
prevents duplicate key combinations. Department_Metrics has
UNIQUE(dept_id,metric_id,cycle_id).

**Why nullable DOI?** Some evidence has no DOI/ISBN. MySQL UNIQUE allows multiple
NULL entries; the trigger also checks duplicate titles.

**Original CHECK error?** MySQL CHECK expressions cannot reference AUTO_INCREMENT
columns. The removed self-parent CHECK referenced metric_id. AFTER INSERT checks
the actual generated ID; BEFORE UPDATE checks reparenting and hierarchy loops.

**Trigger/procedure/function?** A trigger runs automatically on its table event.
A procedure is explicitly CALLed. A function returns a value for expressions.
This project has actor functions, workflow/log triggers and a scoring procedure.

**Score formula?** Count only Approved leaf metrics. Sum faculty scores per
department/metric and cap at the metric maximum. HOD values are percentages.
Normalize, apply leaf weight, multiply by 100 and sum; round the final total.
Missing metrics contribute zero; leaf weights must total 1.00.

**CSE 31.25?** Paper: 18/20 × 0.20 × 100 = 18.
Placement: 88.33/100 × 0.15 × 100 = 13.2495. Rounded total = 31.25.
Pending/Verified records do not count.

**Why exclude parents?** Counting parent and leaf weights would double count.

**Why aggregate pending sources before joining?** Several faculty rows joined
with several department rows multiply records. Group each source first, then join
the summaries.

**SQL/Mongo consistency?** No shared distributed transaction. SQL commits a durable
outbox job and an idempotent worker replaces/deletes Mongo evidence. Pending jobs
can be retried. Review actions require synchronized, existing evidence.

**Authentication versus authorization?** Authentication establishes identity;
authorization determines allowed records/actions. A session alone is insufficient.

**Password storage?** The seed uses SHA2; successful login upgrades the stored
password hash to salted scrypt. Session tokens are random and stored as hashes.

**Does @current_user_id authenticate?** No: it is caller-controlled SQL session
state. The trusted backend authenticates, sets it on the same connection and
clears it before connection reuse. Do not give end users the DB credentials.

**Are logs tamper-proof?** The app account cannot write logs directly; triggers
append status history. A DBA can still change database objects and bypass controls.

**Limitations?** URL-based evidence, no distributed atomic transaction or password
reset, and no full user/metric administration UI. Direct SQL clients do not share
the portal duplicate-check lock. Historical department reassignment needs a policy.

## Originality: supply your own evidence

The instructor asks for novelty not originating from an LLM. This implementation
was AI-assisted. Do not describe generated features as independently invented.

You and your teammate should supply:
- One real problem observed in your department's evidence/review process.
- How you learned it: your experience, interview or actual sample workflow.
- A rule or design decision YOU proposed, with your reason.
- An example you created and tested yourself.
- Each person's actual contribution and the assistance used.

A verification experiment is learning evidence, but does not automatically meet an
independent-novelty requirement. Confirm the instructor's expectation. Do not invent
an interview, institutional requirement or completed feature.

## Test commands

- npm test: local policy/password/report/parsing/seed-link/scoring tests.
- npm run test:sql: temporary QA schema/account; original records preserved.
- npm run test:mongo: validator and unique-index error-code checks.
- npm run test:demo: API workflow on temporary SQL/Mongo databases.
- npm run test:integration: DIRECT test of the configured running server.
  This changes records; do not run it on the presentation DB just to rehearse.

See VERIFICATION.txt for the checks actually completed.

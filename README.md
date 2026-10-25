# Automated Academic & Administrative IQAC Audit and Compliance Management System

## Team

| Name | SRN |
|------|-----|
|Dabbugunta Venya Anand| PES1UG24AM074 |
|Devika N | PES1UG24AM080 |

## Overview

Higher education institutions must gather evidence (research papers, patents, workshops, FDPs, placements, lab infrastructure, budgets) for Internal Quality Assurance Cell (IQAC) audits required by NAAC, NBA and NIRF. This is usually done with scattered spreadsheets, paper trails and shared drives, which leads to duplicate claims, untracked edits, slow manual score calculation and no clear view of what is pending.

This project is a centralized, database-driven system that digitizes the whole audit lifecycle. Evidence is submitted online, reviewed in stages, protected by an audit trail, and scored automatically. MySQL routines and triggers enforce the core workflow, locking, duplicate checks and scoring. The authenticated backend adds row and department access checks; database credentials are never exposed to end users.


## Problems it solves

| Problem | How the system handles it |
|---------|---------------------------|
| Duplicate submissions (co-authored papers claimed by several faculty) | Unique constraints on cycle, faculty and DOI/ISBN, a full-text index on titles, and a DOI/ISBN index for cross-faculty checks |
| No audit trail | Every status change is written to an append-only verification log with user, time and remarks |
| Manual, error-prone scoring | A stored procedure computes weighted scores per department and per cycle |
| Poor visibility of pending work | Status tracking at every stage (Draft, Submitted, Verified, Approved, Rejected) and role-specific views |
| Tampering after approval | Triggers lock approved records and control which status changes are allowed |

## Users and roles

- **Faculty:** upload research papers, patents, workshops, FDPs and mentorship records with evidence links, and track verification status and revision requests.
- **HOD (Head of Department):** verify or reject faculty submissions from their own department, and enter department metrics (placements, budgets, lab upgrades). Auditors verify and approve department metrics.
- **IQAC Auditor:** manage audit cycles, evaluate across departments, approve records, and view cycle-specific department reports. Criteria and weightages are configured through SQL; there is no metrics administration UI.
- **Admin / Principal:** view executive dashboards, lock and archive completed cycles, and inspect the audit logs.


## Submission workflow

```
Draft -> Submitted -> Verified -> Approved
                  \-> Rejected (returned for correction)
```

Faculty submit, the HOD verifies, and the Auditor approves. Once a record is approved it is locked.

## Architecture: two databases

| Database | What it stores | Why |
|----------|----------------|-----|
| **MySQL** (`iqac_db`) | Users, departments, audit cycles, criteria hierarchy, submissions, department metrics, verification logs, score aggregates | Structured, relational data that needs foreign keys, transactions, triggers and stored procedures |
| **MongoDB** (`iqac_nosql`) | Detailed evidence for each submission or department metric | Evidence differs by type (a patent, a workshop and a placement record have different fields) and contains lists (authors, equipment, budget heads), so a flexible document model fits better |

The two are linked by ids. Each MySQL row stores a `mongo_doc_id`, and each Mongo document stores `mysql_submission_id` or `mysql_dept_metric_id`. A unique index guarantees one evidence document per MySQL row.

## Database design

### MySQL tables

| Table | Purpose |
|-------|---------|
| Departments | Academic departments |
| User_Auth_Roles | Users with a role (Faculty, HOD, Auditor, Admin) and department |
| Audit_Cycles | Audit periods, with status Draft, Active, Locked or Archived |
| Criteria_Metrics_Master | Self-referencing hierarchy of criteria, with max score, weightage and target role |
| Faculty_Submissions | Individual contributions linked to a criterion, cycle and evidence |
| Department_Metrics | Department-level values entered by HODs |
| Verification_Logs | Audit trail of every status change |
| Score_Aggregates | Weighted score per department per cycle, computed by a stored procedure |

Constraints include primary and foreign keys with `ON DELETE RESTRICT`, unique keys, `CHECK` constraints (email format, date order, score ranges, URL and ObjectId format), and a rule that each log row refers to exactly one of a faculty submission or a department metric.

### MongoDB collections

| Collection | Contents |
|------------|----------|
| faculty_evidence | One document per faculty submission. The `details` object changes with the submission type (research paper, patent, workshop, FDP, book chapter, mentorship) and is enforced by `$jsonSchema` validation using `oneOf`. |
| department_evidence | One document per department metric (placement, budget, lab upgrade, infrastructure) |

Indexes include a unique link index to MySQL, compound indexes for dashboard filters, a multikey index on `authors.name`, and a weighted text index on title, abstract and keywords.


## Tech stack

- MySQL 8.0.16 or later
- MongoDB (the Node.js setup script can initialize it without mongosh)
- Next.js web application with authentication and role-based access
- Git and GitHub

## Run the application

See [SETUP.md](SETUP.md) for installation, database initialization, application
grants, demo accounts, API routes and the demonstration for evaluation items 9–12.
The Next.js application lives at the repository root; run npm commands here.
No .env.local or credentials are committed.

MySQL script order on a fresh disposable demo database:
01_schema.sql -> 04_seed_data.sql -> optional 05_dml_queries.sql ->
06_triggers.sql -> 07_portal.sql -> 09_score_calculation.sql -> 08_app_grants.sql.

The schema script DROPS iqac_db. Existing databases should install the corrected
triggers and additive portal/scoring scripts without reloading schema or seed.
The setup command installs 07_portal.sql and 09_score_calculation.sql together.

## Item 8: department score calculation

The agreed project policy is a weighted score out of 100. Only Approved records
linked to leaf metrics count. Parent criteria are excluded.

- Faculty leaf raw score = sum of approved awarded scores in that department,
  capped at the metric's max_score.
- Department leaf raw score = metric_value / 100 * max_score.
- Leaf points = raw score / max_score * weightage * 100.
- Add leaf points and round the final total to two decimal places.
- All leaf weights must total 1.00. Missing metrics contribute zero; weights
  are not redistributed. Departments with no approved work receive 0.00.

This is the project scoring policy, not an official accreditation formula.
The original approved seed produces CSE 31.25, ECE 19.50 and ME 0.00.

09_score_calculation.sql adds sp_recalculate_scores(cycle_id). It checks for an
active Auditor/Admin actor, validates the cycle, leaf weights and approved values,
then upserts one Score_Aggregates row per department and cycle. It retains caller
transaction ownership. Archived score snapshots cannot be recalculated.

The API calls this procedure in the approval transaction and immediately before
locking a cycle; failure rolls back the approval/lock. Auditor/Admin users can also
refresh an Active/Locked cycle from the Department scores page. Faculty and HOD
users can read only their own department scorecards. Initial scores can be generated
with that refresh button after setup.

## Reports and local demo

The Reports page includes approved faculty submissions, pending review work and weighted department scores by audit cycle, with CSV export. Faculty/HOD accounts see their own department; Auditor/Admin accounts see all departments. Manual equivalents are in 10_reports.sql.

After setup and a production build, run npm run demo and open http://localhost:3000. Keep the terminal open. See SETUP.md and DEMO_VIVA.md.

## Verification

31 local tests, 11 live SQL check groups, the production build, MongoDB validation checks and the authenticated API integration suite passed on 25 October 2026. Integration checks used disposable QA databases. See VERIFICATION.txt for scope and browser status. The ER diagram and an authentic team contribution still require team review.

## Documentation

- [ER diagram and relationship notes](ER_DIAGRAM.md)
- [Setup and verification commands](SETUP.md)
- [Demo script and viva preparation](DEMO_VIVA.md)
- [Executed verification status](VERIFICATION.txt)
- [Manual report queries](10_reports.sql)

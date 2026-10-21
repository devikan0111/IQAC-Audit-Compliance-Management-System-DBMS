# Automated Academic & Administrative IQAC Audit and Compliance Management System

## Team

| Name | SRN |
|------|-----|
|Dabbugunta Venya Anand| PES1UG24AM074 |
|Devika N | PES1UG24AM080 |

## Overview

Higher education institutions must gather evidence (research papers, patents, workshops, FDPs, placements, lab infrastructure, budgets) for Internal Quality Assurance Cell (IQAC) audits required by NAAC, NBA and NIRF. This is usually done with scattered spreadsheets, paper trails and shared drives, which leads to duplicate claims, untracked edits, slow manual score calculation and no clear view of what is pending.

This project is a centralized, database-driven system that digitizes the whole audit lifecycle. Evidence is submitted online, reviewed in stages, protected by an audit trail, and scored automatically. The important rules (workflow, locking, duplicate checks, scoring) live inside the database itself, so they cannot be bypassed by the application.


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
- **HOD (Head of Department):** review and verify faculty submissions, enter department metrics (placements, budgets, lab upgrades), and approve or reject with remarks.
- **IQAC Auditor:** configure audit cycles, criteria and weightages, evaluate across departments, approve records, and generate consolidated AQAR reports.
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
- MongoDB with Compass and mongosh
- Next.js web application with authentication and role-based access
- Git and GitHub

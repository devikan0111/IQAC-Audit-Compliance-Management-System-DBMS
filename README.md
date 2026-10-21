# Automated Academic & Administrative IQAC Audit and Compliance Management System

DBMS Mini Project (Experiential Learning Level 3), PES University, Department of CSE, Aug-Dec 2026.

A centralized, database-driven system that digitizes the IQAC audit lifecycle used for NAAC / NBA / NIRF accreditation: evidence submission, multi-stage verification (Faculty -> HOD -> Auditor), duplicate detection, tamper-proof audit logs, and weighted score calculation, with the core logic placed in the database tier.

## Team

| Name | SRN | Contribution |
|------|-----|--------------|
| _your name_ | PES1UG24AM074 | _fill in_ |
| _teammate name_ | PES1UG24AM080 | _fill in_ |

## Tech stack

- **MySQL 8.0.16+**: structured data, constraints, triggers, stored procedures, views, full-text index
- **MongoDB**: flexible evidence details per submission type (`$jsonSchema` validation, text and multikey indexes)
- **Next.js**: web interface with login and role-based access _(in progress)_

## Why two databases

MySQL holds the relational, scored, workflow data (users, cycles, criteria, submissions, approvals, logs). MongoDB holds the evidence details, which differ by type (patent, workshop, placement record) and contain lists. Each MySQL row points to its Mongo document through `mongo_doc_id`, and each Mongo document points back through `mysql_submission_id` / `mysql_dept_metric_id`.

## Repository layout

```
sql/      MySQL scripts (schema, seed data, queries, procedures, triggers, views)
mongo/    MongoDB scripts (setup, demo queries)
logs/     Execution logs (proof of running each script)
docs/     Synopsis, ER diagram, relational schema
app/      Next.js web application
```

## How to run

1. **MySQL schema:** `mysql -u root -p < sql/01_schema.sql`
2. **MySQL seed data:** `mysql -u root -p < sql/04_seed_data.sql`
3. **MongoDB setup:** `mongosh "mongodb://localhost:27017" --file mongo/02_mongo_setup.js`
4. **MongoDB demo queries:** `mongosh "mongodb://localhost:27017" --file mongo/03_mongo_tests.js`

## Roles

Faculty, HOD, Auditor, Admin.

## Progress

- [x] ER diagram and relational schema
- [x] MySQL DDL
- [x] MongoDB creation, validation and indexes
- [ ] MySQL seed data
- [ ] DML, joins, nested / correlated / recursive queries
- [ ] Stored procedures, triggers, views, CTE
- [ ] MongoDB read / update / delete operations
- [ ] Next.js interface with authentication and role-based access

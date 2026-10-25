# IQAC entity relationship diagram

This diagram covers all eight core tables in 01_schema.sql. PK means primary key; FK means foreign key. Additional portal support tables are defined in 07_portal.sql. The SQL files are the authoritative definition of all columns, checks and indexes.

```mermaid
erDiagram
 Departments ||--o{ User_Auth_Roles : has
 User_Auth_Roles ||--o{ Audit_Cycles : creates
 Criteria_Metrics_Master o|--o{ Criteria_Metrics_Master : parent_of
 User_Auth_Roles ||--o{ Faculty_Submissions : submits
 Criteria_Metrics_Master ||--o{ Faculty_Submissions : measures
 Audit_Cycles ||--o{ Faculty_Submissions : contains
 Departments ||--o{ Department_Metrics : reports
 User_Auth_Roles ||--o{ Department_Metrics : enters
 Criteria_Metrics_Master ||--o{ Department_Metrics : measures
 Audit_Cycles ||--o{ Department_Metrics : contains
 Faculty_Submissions o|--o{ Verification_Logs : history
 Department_Metrics o|--o{ Verification_Logs : history
 User_Auth_Roles ||--o{ Verification_Logs : acts
 Audit_Cycles ||--o{ Score_Aggregates : summarizes
 Departments ||--o{ Score_Aggregates : receives
 Departments {
  int dept_id PK
  varchar dept_code UK
  varchar dept_name UK
 }
 User_Auth_Roles {
  int user_id PK
  int dept_id FK "nullable for institution roles"
  varchar email UK
  enum role
 }
 Audit_Cycles {
  int cycle_id PK
  int created_by FK
  varchar cycle_name UK
  enum status
 }
 Criteria_Metrics_Master {
  int metric_id PK
  int parent_metric_id FK "nullable for roots"
  varchar criteria_number UK
  decimal max_score
  decimal weightage
 }
 Faculty_Submissions {
  int submission_id PK
  int faculty_id FK
  int metric_id FK
  int cycle_id FK
  char mongo_doc_id "external document reference"
  enum status
 }
 Department_Metrics {
  int dept_metric_id PK
  int dept_id FK
  int hod_id FK
  int metric_id FK
  int cycle_id FK
  char mongo_doc_id "external document reference"
 }
 Verification_Logs {
  int log_id PK
  int submission_id FK "nullable"
  int dept_metric_id FK "nullable"
  int action_by_user_id FK
 }
 Score_Aggregates {
  int aggregate_id PK
  int cycle_id FK
  int dept_id FK
  decimal total_weighted_score
 }
```

A verification log references exactly one submission or department metric, enforced by a CHECK. Each cycle/department pair has at most one score aggregate. Each department/metric/cycle combination has at most one department metric. Faculty submissions have a unique cycle/faculty/DOI-or-ISBN combination; NULL identifiers require additional duplicate handling.

MongoDB evidence links are application-managed references, not cross-database foreign keys. The outbox synchronizes evidence changes. The self-parent trigger rejects a metric directly parenting itself; this alone does not establish arbitrary cycle detection in the metric tree.

For the viva, explain one-to-many relationships, nullable institution-level department membership, primary and foreign keys, and why evidence documents live separately in MongoDB. GitHub renders this Mermaid diagram when viewing the file.

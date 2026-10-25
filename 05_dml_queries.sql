-- =====================================================================
-- IQAC Audit & Compliance Management System
-- STEP 5a: DML operations and SQL queries
--
-- Run AFTER 01_schema.sql and 04_seed_data.sql, and BEFORE the triggers
-- (the UPDATE / DELETE demos would otherwise be policed by them).
--
--   inside the mysql client:  source C:/path/to/05_dml_queries.sql;
--
-- Every DML demo runs inside START TRANSACTION ... ROLLBACK, so you can
-- show the effect (the SELECT after each change) and the seed data stays
-- exactly as it was. (Rolled-back inserts still use up AUTO_INCREMENT
-- numbers, so the next real insert may get an id above 7. That is normal.)
-- =====================================================================

USE iqac_db;

-- #####################################################################
-- PART A : DML OPERATIONS  (INSERT / UPDATE / DELETE)
-- #####################################################################

-- ---------------------------------------------------------------------
-- A1. INSERT: a faculty member creates a Draft submission, and the audit
--     trail records it
-- ---------------------------------------------------------------------
SELECT 'A1  INSERT a draft submission + its log entry' AS demo;
START TRANSACTION;

INSERT INTO Faculty_Submissions
    (faculty_id, metric_id, cycle_id, title, doi_or_isbn, evidence_url, status)
VALUES
    (5, 6, 1, 'Practical Guide to Advanced Database Systems',
     '978-81-2345-678-9', 'https://drive.example.edu/book_chapter.pdf', 'Draft');

SET @new_sub = LAST_INSERT_ID();

INSERT INTO Verification_Logs
    (submission_id, dept_metric_id, action_by_user_id, previous_status, new_status, remarks)
VALUES
    (@new_sub, NULL, 5, NULL, 'Draft', 'Draft created');

SELECT submission_id, faculty_id, title, status FROM Faculty_Submissions WHERE submission_id = @new_sub;
SELECT log_id, submission_id, new_status, remarks FROM Verification_Logs WHERE submission_id = @new_sub;

-- ---------------------------------------------------------------------
-- A2. INSERT: an HOD enters a department metric (placement percentage)
-- ---------------------------------------------------------------------
SELECT 'A2  INSERT a department metric' AS demo;
INSERT INTO Department_Metrics
    (dept_id, hod_id, metric_id, cycle_id, metric_value, evidence_url, status)
VALUES
    (2, 4, 17, 1, 72.50, 'https://drive.example.edu/ece_offers.pdf', 'Draft');

SELECT dept_metric_id, dept_id, metric_id, metric_value, status
FROM Department_Metrics WHERE dept_id = 2 ORDER BY dept_metric_id;

-- ---------------------------------------------------------------------
-- A3. UPDATE (multi-table): submit every Draft belonging to CSE faculty
--     (UPDATE with a JOIN)
-- ---------------------------------------------------------------------
SELECT 'A3  UPDATE with JOIN: submit all CSE drafts' AS demo;
UPDATE Faculty_Submissions s
JOIN   User_Auth_Roles u ON u.user_id = s.faculty_id
SET    s.status = 'Submitted'
WHERE  u.dept_id = 1 AND s.status = 'Draft';

SELECT submission_id, title, status FROM Faculty_Submissions WHERE submission_id = @new_sub;
ROLLBACK;

-- ---------------------------------------------------------------------
-- A4. UPDATE: the approval workflow for submission 2
--     Submitted -> Verified (HOD) -> Approved with a score (Auditor)
-- ---------------------------------------------------------------------
SELECT 'A4  UPDATE: HOD verifies, then Auditor approves submission 2' AS demo;
START TRANSACTION;

UPDATE Faculty_Submissions SET status = 'Verified' WHERE submission_id = 2;
INSERT INTO Verification_Logs (submission_id, action_by_user_id, previous_status, new_status, remarks)
VALUES (2, 3, 'Submitted', 'Verified', 'DOI and journal indexing checked');

UPDATE Faculty_Submissions SET status = 'Approved', score_awarded = 16.50 WHERE submission_id = 2;
INSERT INTO Verification_Logs (submission_id, action_by_user_id, previous_status, new_status, remarks)
VALUES (2, 2, 'Verified', 'Approved', 'WoS indexed; score 16.5 of 20 awarded');

SELECT submission_id, status, score_awarded FROM Faculty_Submissions WHERE submission_id = 2;
SELECT log_id, previous_status, new_status, remarks
FROM Verification_Logs WHERE submission_id = 2 ORDER BY log_id;
ROLLBACK;

-- ---------------------------------------------------------------------
-- A5. UPDATE: deactivate a user account (soft delete, no data lost)
-- ---------------------------------------------------------------------
SELECT 'A5  UPDATE: deactivate a user' AS demo;
START TRANSACTION;
UPDATE User_Auth_Roles SET is_active = FALSE WHERE email = 'priya.nair@pes.edu';
SELECT user_id, first_name, last_name, is_active FROM User_Auth_Roles WHERE email = 'priya.nair@pes.edu';
ROLLBACK;

-- ---------------------------------------------------------------------
-- A6. DELETE: a faculty member withdraws a Draft submission.
--     Only rows still in Draft can be deleted; anything with an audit
--     trail is protected by the ON DELETE RESTRICT foreign keys.
-- ---------------------------------------------------------------------
SELECT 'A6  DELETE a Draft submission' AS demo;
START TRANSACTION;
INSERT INTO Faculty_Submissions
    (faculty_id, metric_id, cycle_id, title, evidence_url, status)
VALUES (6, 9, 1, 'Temporary draft to be withdrawn', 'https://drive.example.edu/temp.pdf', 'Draft');
SET @tmp = LAST_INSERT_ID();
SELECT COUNT(*) AS rows_before FROM Faculty_Submissions;

DELETE FROM Faculty_Submissions WHERE submission_id = @tmp AND status = 'Draft';

SELECT COUNT(*) AS rows_after FROM Faculty_Submissions;
ROLLBACK;

-- ---------------------------------------------------------------------
-- A7. DELETE protected by a foreign key (EXPECTED TO FAIL).
--     Not run automatically, because an error would stop `source`.
--     Paste it manually in the client to show the protection:
--
--       DELETE FROM Faculty_Submissions WHERE submission_id = 1;
--       -- ERROR 1451: Cannot delete or update a parent row: a foreign
--       --             key constraint fails (Verification_Logs references it)
-- ---------------------------------------------------------------------


-- #####################################################################
-- PART B : QUERIES
-- #####################################################################

-- ---------------------------------------------------------------------
-- B1. INNER JOIN (5 tables): every submission with who, where, what
-- ---------------------------------------------------------------------
SELECT 'B1  INNER JOIN across 5 tables' AS query_title;
SELECT s.submission_id,
       CONCAT(u.first_name, ' ', u.last_name) AS faculty,
       d.dept_code,
       m.criteria_number,
       c.cycle_name,
       s.status,
       s.score_awarded
FROM   Faculty_Submissions s
JOIN   User_Auth_Roles        u ON u.user_id   = s.faculty_id
JOIN   Departments            d ON d.dept_id   = u.dept_id
JOIN   Criteria_Metrics_Master m ON m.metric_id = s.metric_id
JOIN   Audit_Cycles           c ON c.cycle_id  = s.cycle_id
ORDER  BY s.submission_id;

-- ---------------------------------------------------------------------
-- B2. LEFT JOIN: approved submissions per department, INCLUDING
--     departments with none (Mechanical has no faculty yet)
-- ---------------------------------------------------------------------
SELECT 'B2  LEFT JOIN: approved submissions per department (zeros included)' AS query_title;
SELECT d.dept_code,
       d.dept_name,
       COUNT(s.submission_id) AS approved_submissions
FROM   Departments d
LEFT   JOIN User_Auth_Roles u        ON u.dept_id = d.dept_id AND u.role = 'Faculty'
LEFT   JOIN Faculty_Submissions s    ON s.faculty_id = u.user_id AND s.status = 'Approved'
GROUP  BY d.dept_id, d.dept_name, d.dept_code
ORDER  BY approved_submissions DESC;

-- ---------------------------------------------------------------------
-- B3. JOIN + audit trail: who did what to submission 1, in order
-- ---------------------------------------------------------------------
SELECT 'B3  Audit trail of submission 1 (JOIN logs with users)' AS query_title;
SELECT l.log_id,
       l.logged_at,
       CONCAT(u.first_name, ' ', u.last_name) AS action_by,
       u.role,
       l.previous_status,
       l.new_status,
       l.remarks
FROM   Verification_Logs l
JOIN   User_Auth_Roles u ON u.user_id = l.action_by_user_id
WHERE  l.submission_id = 1
ORDER  BY l.logged_at;

-- ---------------------------------------------------------------------
-- B4. NESTED query (IN): faculty who have at least one Approved submission
-- ---------------------------------------------------------------------
SELECT 'B4  Nested query with IN: faculty with an approved submission' AS query_title;
SELECT user_id, first_name, last_name
FROM   User_Auth_Roles
WHERE  role = 'Faculty'
  AND  user_id IN (SELECT faculty_id
                   FROM   Faculty_Submissions
                   WHERE  status = 'Approved');

-- ---------------------------------------------------------------------
-- B5. NESTED query (scalar subquery): submissions scored above average
-- ---------------------------------------------------------------------
SELECT 'B5  Nested scalar subquery: scored above the average awarded score' AS query_title;
SELECT submission_id, title, score_awarded
FROM   Faculty_Submissions
WHERE  score_awarded > (SELECT AVG(score_awarded)
                        FROM   Faculty_Submissions
                        WHERE  score_awarded IS NOT NULL);

-- ---------------------------------------------------------------------
-- B6. CORRELATED query (NOT EXISTS): faculty who have never had a
--     submission Rejected
-- ---------------------------------------------------------------------
SELECT 'B6  Correlated NOT EXISTS: faculty with no rejected submission' AS query_title;
SELECT u.user_id, u.first_name, u.last_name
FROM   User_Auth_Roles u
WHERE  u.role = 'Faculty'
  AND  NOT EXISTS (SELECT 1
                   FROM   Faculty_Submissions s
                   WHERE  s.faculty_id = u.user_id      -- refers to the outer row
                     AND  s.status = 'Rejected');

-- ---------------------------------------------------------------------
-- B7. CORRELATED query (latest log per submission): the current state
--     according to the audit trail
-- ---------------------------------------------------------------------
SELECT 'B7  Correlated subquery: latest log entry of each submission' AS query_title;
SELECT l.submission_id, l.new_status AS latest_status, l.logged_at, l.remarks
FROM   Verification_Logs l
WHERE  l.submission_id IS NOT NULL
  AND  l.log_id = (SELECT MAX(l2.log_id)
                   FROM   Verification_Logs l2
                   WHERE  l2.submission_id = l.submission_id)   -- correlated
ORDER  BY l.submission_id;

-- ---------------------------------------------------------------------
-- B8. RECURSIVE CTE (downwards): the whole criteria tree, indented
--     Criterion -> Key Indicator -> Metric
-- ---------------------------------------------------------------------
SELECT 'B8  Recursive CTE: criteria hierarchy (top-down)' AS query_title;
WITH RECURSIVE criteria_tree AS (
    SELECT metric_id, parent_metric_id, criteria_number, description,
           1 AS level,
           CAST(criteria_number AS CHAR(200)) AS path
    FROM   Criteria_Metrics_Master
    WHERE  parent_metric_id IS NULL
  UNION ALL
    SELECT c.metric_id, c.parent_metric_id, c.criteria_number, c.description,
           t.level + 1,
           CONCAT(t.path, ' > ', c.criteria_number)
    FROM   Criteria_Metrics_Master c
    JOIN   criteria_tree t ON c.parent_metric_id = t.metric_id
)
SELECT CONCAT(REPEAT('    ', level - 1), criteria_number) AS criterion,
       level,
       description
FROM   criteria_tree
ORDER  BY path;

-- ---------------------------------------------------------------------
-- B9. RECURSIVE CTE (upwards): the chain of ancestors of one metric,
--     e.g. which criterion does metric 3.3.1 belong to?
-- ---------------------------------------------------------------------
SELECT 'B9  Recursive CTE: ancestors of metric 3.3.1 (bottom-up)' AS query_title;
WITH RECURSIVE ancestors AS (
    SELECT metric_id, parent_metric_id, criteria_number, description, 0 AS steps_up
    FROM   Criteria_Metrics_Master
    WHERE  criteria_number = '3.3.1'
  UNION ALL
    SELECT p.metric_id, p.parent_metric_id, p.criteria_number, p.description, a.steps_up + 1
    FROM   Criteria_Metrics_Master p
    JOIN   ancestors a ON p.metric_id = a.parent_metric_id
)
SELECT steps_up, criteria_number, description
FROM   ancestors
ORDER  BY steps_up;

-- ---------------------------------------------------------------------
-- B10. GROUP BY + HAVING: departments where at least one submission
--      is still waiting (Submitted or Verified)
-- ---------------------------------------------------------------------
SELECT 'B10 GROUP BY / HAVING: departments with pending work' AS query_title;
SELECT d.dept_code,
       COUNT(*)                         AS pending_submissions,
       SUM(s.status = 'Submitted')      AS waiting_for_hod,
       SUM(s.status = 'Verified')       AS waiting_for_auditor
FROM   Faculty_Submissions s
JOIN   User_Auth_Roles u ON u.user_id = s.faculty_id
JOIN   Departments d     ON d.dept_id = u.dept_id
WHERE  s.status IN ('Submitted', 'Verified')
GROUP  BY d.dept_id, d.dept_code
HAVING COUNT(*) >= 1
ORDER  BY pending_submissions DESC;

-- ---------------------------------------------------------------------
-- B11. UNION ALL: one worklist for faculty submissions AND department
--      metrics (the Auditor's "pending verification" dashboard)
-- ---------------------------------------------------------------------
SELECT 'B11 UNION ALL: auditor worklist (faculty + department items)' AS query_title;
SELECT 'Faculty submission' AS item_type, s.submission_id AS item_id,
       s.title AS description, s.status
FROM   Faculty_Submissions s
WHERE  s.status = 'Verified'
UNION ALL
SELECT 'Department metric', dm.dept_metric_id,
       CONCAT(d.dept_code, ' - ', m.criteria_number, ' = ', dm.metric_value), dm.status
FROM   Department_Metrics dm
JOIN   Departments d             ON d.dept_id   = dm.dept_id
JOIN   Criteria_Metrics_Master m ON m.metric_id = dm.metric_id
WHERE  dm.status = 'Verified';

-- ---------------------------------------------------------------------
-- B12. Aggregate: total approved score per faculty member
-- ---------------------------------------------------------------------
SELECT 'B12 Aggregate: approved score per faculty (SUM, COUNT, AVG)' AS query_title;
SELECT CONCAT(u.first_name, ' ', u.last_name) AS faculty,
       COUNT(*)                 AS approved_items,
       SUM(s.score_awarded)     AS total_score,
       ROUND(AVG(s.score_awarded), 2) AS average_score
FROM   Faculty_Submissions s
JOIN   User_Auth_Roles u ON u.user_id = s.faculty_id
WHERE  s.status = 'Approved'
GROUP  BY u.user_id, u.first_name, u.last_name
ORDER  BY total_score DESC;

-- ---------------------------------------------------------------------
-- B13. FULL-TEXT SEARCH: find possible duplicates of a title.
--      Boolean mode with a prefix wildcard (diagnostic*) matches both
--      "Diagnostic" and "Diagnostics", which a plain "=" comparison
--      or LIKE with the full title would miss.
-- ---------------------------------------------------------------------
SELECT 'B13 Full-text search: submissions with diagnostic-related titles' AS query_title;
SELECT submission_id, title,
       MATCH(title) AGAINST('diagnostic* medical* healthcare*' IN BOOLEAN MODE) AS relevance
FROM   Faculty_Submissions
WHERE  MATCH(title) AGAINST('diagnostic* medical* healthcare*' IN BOOLEAN MODE)
ORDER  BY relevance DESC;

-- ---------------------------------------------------------------------
-- B14. Same-DOI duplicate check across ALL faculty (what the Step 5b
--      trigger will automate): no row means no duplicate DOI exists
-- ---------------------------------------------------------------------
SELECT 'B14 Cross-faculty duplicate DOI/ISBN check (empty = no duplicates)' AS query_title;
SELECT doi_or_isbn, COUNT(DISTINCT faculty_id) AS claimed_by, COUNT(*) AS times_claimed
FROM   Faculty_Submissions
WHERE  doi_or_isbn IS NOT NULL
GROUP  BY doi_or_isbn
HAVING COUNT(*) > 1;

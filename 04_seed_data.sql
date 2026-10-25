-- =====================================================================
-- IQAC Audit & Compliance Management System
-- STEP 4: MySQL seed data
--
-- Run AFTER 01_schema.sql, on a fresh iqac_db, and BEFORE the triggers of
-- Step 5 are created (the rows below already contain Approved/Rejected
-- statuses, which the Step 5 triggers would otherwise police).
--
--   mysql -u root -p < 04_seed_data.sql
--   or, inside the mysql client:  source C:/path/to/04_seed_data.sql;
--
-- Link with MongoDB (iqac_nosql):
--   Faculty_Submissions.mongo_doc_id  = faculty_evidence._id   (65a0...01 to 06)
--   Department_Metrics.mongo_doc_id   = department_evidence._id (65b0...01 to 03)
--   Ids are fixed so both databases agree with 02_mongo_setup.js:
--     users 5,6 = CSE faculty, 7 = ECE faculty; dept 1 = CSE, 2 = ECE; cycle 1.
--
-- Demo password for EVERY user: Pass@123  (stored as SHA2-256 for now; the
-- Next.js login in Step 7 will switch to bcrypt hashes).
-- =====================================================================

USE iqac_db;

-- ---------------------------------------------------------------------
-- 1. Departments
-- ---------------------------------------------------------------------
INSERT INTO Departments (dept_id, dept_name, dept_code) VALUES
 (1, 'Computer Science and Engineering',      'CSE'),
 (2, 'Electronics and Communication Engineering', 'ECE'),
 (3, 'Mechanical Engineering',                'ME');

-- ---------------------------------------------------------------------
-- 2. Users  (1 Admin, 2 Auditor, 3-4 HODs, 5-7 Faculty)
-- ---------------------------------------------------------------------
INSERT INTO User_Auth_Roles
 (user_id, first_name, last_name, email, password_hash, role, dept_id, is_active) VALUES
 (1, 'Suresh', 'Menon',  'principal@pes.edu',   SHA2('Pass@123', 256), 'Admin',   NULL, TRUE),
 (2, 'Kavita', 'Sharma', 'auditor@pes.edu',     SHA2('Pass@123', 256), 'Auditor', NULL, TRUE),
 (3, 'Arjun',  'Prasad', 'hod.cse@pes.edu',     SHA2('Pass@123', 256), 'HOD',     1,    TRUE),
 (4, 'Lakshmi','Reddy',  'hod.ece@pes.edu',     SHA2('Pass@123', 256), 'HOD',     2,    TRUE),
 (5, 'Ravi',   'Kumar',  'ravi.kumar@pes.edu',  SHA2('Pass@123', 256), 'Faculty', 1,    TRUE),
 (6, 'Meena',  'Iyer',   'meena.iyer@pes.edu',  SHA2('Pass@123', 256), 'Faculty', 1,    TRUE),
 (7, 'Priya',  'Nair',   'priya.nair@pes.edu',  SHA2('Pass@123', 256), 'Faculty', 2,    TRUE);

-- ---------------------------------------------------------------------
-- 3. Audit cycles
-- ---------------------------------------------------------------------
INSERT INTO Audit_Cycles (cycle_id, cycle_name, start_date, end_date, status, created_by) VALUES
 (1, 'AQAR 2025-26', '2025-08-01', '2026-07-31', 'Active',   2),
 (2, 'AQAR 2024-25', '2024-08-01', '2025-07-31', 'Archived', 1);

-- ---------------------------------------------------------------------
-- 4. Criteria_Metrics_Master  (hierarchy: Criterion -> Key Indicator -> Metric)
--    Parents are inserted before children (self-referencing FK).
--    Weights are set on the LEAF metrics (rows with no children) and add up
--    to 1.00:  Faculty leaves 0.65  +  HOD leaves 0.35.
--    Parent rows carry the sum of their leaves for reporting.
--    HOD leaf metrics are measured as a percentage (0-100), so
--    Step 5 can normalise them as  metric_value / 100 * max_score.
-- ---------------------------------------------------------------------
INSERT INTO Criteria_Metrics_Master
 (metric_id, parent_metric_id, criteria_number, description, metric_type, max_score, weightage, target_role) VALUES
 -- Criterion 3 : Research (Faculty)
 (1,  NULL, '3',     'Research, Innovations and Extension',                               'Quantitative', 40.00, 0.40, 'Faculty'),
 (2,  1,    '3.2',   'Innovation Ecosystem',                                              'Quantitative', 10.00, 0.10, 'Faculty'),
 (3,  2,    '3.2.1', 'Patents published or granted',                                      'Quantitative', 10.00, 0.10, 'Faculty'),
 (4,  1,    '3.3',   'Research Publications',                                             'Quantitative', 30.00, 0.30, 'Faculty'),
 (5,  4,    '3.3.1', 'Research papers in Scopus / Web of Science / UGC-CARE journals',    'Quantitative', 20.00, 0.20, 'Faculty'),
 (6,  4,    '3.3.2', 'Books and book chapters published',                                 'Quantitative', 10.00, 0.10, 'Faculty'),
 -- Criterion 2 : Teaching-Learning (Faculty)
 (7,  NULL, '2',     'Teaching-Learning and Evaluation',                                  'Quantitative', 20.00, 0.25, 'Faculty'),
 (8,  7,    '2.4',   'Teacher Profile and Quality',                                       'Quantitative', 10.00, 0.15, 'Faculty'),
 (9,  8,    '2.4.1', 'Workshops and FDPs attended or organised',                          'Quantitative', 10.00, 0.15, 'Faculty'),
 (10, 7,    '2.3',   'Teaching-Learning Process',                                         'Qualitative',  10.00, 0.10, 'Faculty'),
 (11, 10,   '2.3.4', 'Student mentoring (mentor-mentee scheme)',                          'Qualitative',  10.00, 0.10, 'Faculty'),
 -- Criterion 4 : Infrastructure (HOD)
 (12, NULL, '4',     'Infrastructure and Learning Resources',                             'Quantitative', 10.00, 0.10, 'HOD'),
 (13, 12,   '4.1',   'Physical Facilities',                                               'Quantitative', 10.00, 0.10, 'HOD'),
 (14, 13,   '4.1.3', 'Percentage of laboratories upgraded during the cycle',              'Quantitative', 10.00, 0.10, 'HOD'),
 -- Criterion 5 : Student Support and Progression (HOD)
 (15, NULL, '5',     'Student Support and Progression',                                   'Quantitative', 20.00, 0.15, 'HOD'),
 (16, 15,   '5.2',   'Student Progression',                                               'Quantitative', 20.00, 0.15, 'HOD'),
 (17, 16,   '5.2.1', 'Percentage of eligible students placed',                            'Quantitative', 20.00, 0.15, 'HOD'),
 -- Criterion 6 : Governance and Finance (HOD)
 (18, NULL, '6',     'Governance, Leadership and Management',                             'Quantitative', 10.00, 0.10, 'HOD'),
 (19, 18,   '6.4',   'Financial Management and Resource Mobilisation',                    'Quantitative', 10.00, 0.10, 'HOD'),
 (20, 19,   '6.4.1', 'Percentage of allocated budget utilised',                           'Quantitative', 10.00, 0.10, 'HOD');

-- ---------------------------------------------------------------------
-- 5. Faculty_Submissions  (titles / URLs / ids match faculty_evidence in Mongo)
--    Sub 1 and 2 are two similar AI-in-healthcare papers on purpose:
--    they drive the full-text duplicate-detection demo in Step 5.
-- ---------------------------------------------------------------------
INSERT INTO Faculty_Submissions
 (submission_id, faculty_id, metric_id, cycle_id, title, doi_or_isbn, evidence_url,
  mongo_doc_id, score_awarded, status, created_at) VALUES
 (1, 5, 5, 1, 'AI in Healthcare: A Survey of Diagnostic Models',
     '10.1109/ACCESS.2025.1001', 'https://drive.example.edu/ai_healthcare.pdf',
     '65a000000000000000000001', 18.00, 'Approved',  '2026-01-10 09:30:00'),
 (2, 6, 5, 1, 'Machine Learning Applications in Medical Diagnostics',
     '10.1007/hi.2025.2002',    'https://drive.example.edu/ml_med_diag.pdf',
     '65a000000000000000000002', NULL,  'Submitted', '2026-01-12 11:00:00'),
 (3, 5, 3, 1, 'Low-Cost IoT Device for Soil Moisture Monitoring',
     'IN202641012345',          'https://drive.example.edu/patent_filing.pdf',
     '65a000000000000000000003', NULL,  'Verified',  '2026-02-02 10:00:00'),
 (4, 7, 9, 1, 'Hands-on Workshop on Embedded Systems Design',
     NULL,                      'https://drive.example.edu/workshop_certificate.pdf',
     '65a000000000000000000004', 8.00,  'Approved',  '2026-02-15 14:00:00'),
 (5, 6, 9, 1, 'FDP on Cloud Computing and DevOps',
     NULL,                      'https://drive.example.edu/fdp_cloud_devops.pdf',
     '65a000000000000000000005', NULL,  'Rejected',  '2026-03-01 09:00:00'),
 (6, 7, 11, 1, 'Student Mentorship Programme 2025-26',
     NULL,                      'https://drive.example.edu/mentorship_2025_26.pdf',
     '65a000000000000000000006', 7.50,  'Approved',  '2026-03-10 09:00:00');

-- ---------------------------------------------------------------------
-- 6. Department_Metrics  (ids match department_evidence in Mongo)
--    metric_value is a percentage:
--      placement  106/120               = 88.33
--      labs       3 of 5 labs upgraded  = 60.00
--      budget     3,650,000/4,000,000   = 91.25
-- ---------------------------------------------------------------------
INSERT INTO Department_Metrics
 (dept_metric_id, dept_id, hod_id, metric_id, cycle_id, metric_value, evidence_url,
  mongo_doc_id, status) VALUES
 (1, 1, 3, 17, 1, 88.33, 'https://drive.example.edu/cse_offers.pdf',
     '65b000000000000000000001', 'Approved'),
 (2, 1, 3, 14, 1, 60.00, 'https://drive.example.edu/cse_lab_invoice.pdf',
     '65b000000000000000000002', 'Verified'),
 (3, 2, 4, 20, 1, 91.25, 'https://drive.example.edu/ece_budget.pdf',
     '65b000000000000000000003', 'Submitted');

-- ---------------------------------------------------------------------
-- 7. Verification_Logs  (manual history for the seed rows; from Step 5 on,
--    the triggers write these rows automatically)
--    Exactly one of submission_id / dept_metric_id is filled in each row.
-- ---------------------------------------------------------------------
INSERT INTO Verification_Logs
 (submission_id, dept_metric_id, action_by_user_id, previous_status, new_status, remarks, logged_at) VALUES
 -- submission 1 : Approved
 (1, NULL, 5, 'Draft',     'Submitted', 'Submitted for AQAR 2025-26',              '2026-01-10 09:35:00'),
 (1, NULL, 3, 'Submitted', 'Verified',  'DOI and journal indexing checked',        '2026-01-15 10:00:00'),
 (1, NULL, 2, 'Verified',  'Approved',  'Scopus indexed; score 18 of 20 awarded',  '2026-01-20 11:30:00'),
 -- submission 2 : Submitted (waiting for HOD)
 (2, NULL, 6, 'Draft',     'Submitted', 'Submitted for AQAR 2025-26',              '2026-01-12 11:05:00'),
 -- submission 3 : Verified (waiting for auditor)
 (3, NULL, 5, 'Draft',     'Submitted', 'Patent published, filing proof attached', '2026-02-02 10:05:00'),
 (3, NULL, 3, 'Submitted', 'Verified',  'Patent number verified',                  '2026-02-06 09:45:00'),
 -- submission 4 : Approved
 (4, NULL, 7, 'Draft',     'Submitted', 'Resource person certificate attached',    '2026-02-15 14:05:00'),
 (4, NULL, 4, 'Submitted', 'Verified',  'Certificate verified',                    '2026-02-18 10:00:00'),
 (4, NULL, 2, 'Verified',  'Approved',  'Score 8 of 10 awarded',                   '2026-02-22 15:00:00'),
 -- submission 5 : Rejected
 (5, NULL, 6, 'Draft',     'Submitted', 'FDP participation',                       '2026-03-01 09:05:00'),
 (5, NULL, 3, 'Submitted', 'Rejected',  'Participation certificate missing; please upload proof and resubmit', '2026-03-04 12:00:00'),
 -- submission 6 : Approved
 (6, NULL, 7, 'Draft',     'Submitted', 'Mentor-mentee scheme, 20 mentees',        '2026-03-10 09:05:00'),
 (6, NULL, 4, 'Submitted', 'Verified',  'Mentee list verified',                    '2026-03-12 10:00:00'),
 (6, NULL, 2, 'Verified',  'Approved',  'Score 7.5 of 10 awarded',                 '2026-03-16 14:00:00'),
 -- department metric 1 : Approved
 (NULL, 1, 3, 'Draft',     'Submitted', 'CSE placement data 2025-26',              '2026-04-05 10:05:00'),
 (NULL, 1, 2, 'Submitted', 'Verified',  'Offer letters cross-checked',             '2026-04-09 11:00:00'),
 (NULL, 1, 2, 'Verified',  'Approved',  'Placement figures accepted',              '2026-04-12 11:30:00'),
 -- department metric 2 : Verified
 (NULL, 2, 3, 'Draft',     'Submitted', 'AI & ML lab upgrade',                     '2026-04-08 10:05:00'),
 (NULL, 2, 2, 'Submitted', 'Verified',  'Vendor invoice verified',                 '2026-04-13 10:00:00'),
 -- department metric 3 : Submitted
 (NULL, 3, 4, 'Draft',     'Submitted', 'ECE budget utilisation',                  '2026-04-10 10:05:00');

-- ---------------------------------------------------------------------
-- Quick verification
-- ---------------------------------------------------------------------
SELECT 'Departments' AS tbl, COUNT(*) AS row_count FROM Departments
UNION ALL SELECT 'User_Auth_Roles',          COUNT(*) FROM User_Auth_Roles
UNION ALL SELECT 'Audit_Cycles',             COUNT(*) FROM Audit_Cycles
UNION ALL SELECT 'Criteria_Metrics_Master',  COUNT(*) FROM Criteria_Metrics_Master
UNION ALL SELECT 'Faculty_Submissions',      COUNT(*) FROM Faculty_Submissions
UNION ALL SELECT 'Department_Metrics',       COUNT(*) FROM Department_Metrics
UNION ALL SELECT 'Verification_Logs',        COUNT(*) FROM Verification_Logs
UNION ALL SELECT 'Score_Aggregates',         COUNT(*) FROM Score_Aggregates;

-- Which Mongo document each MySQL row points to
SELECT s.submission_id, CONCAT(u.first_name, ' ', u.last_name) AS faculty,
       s.status, s.score_awarded, s.mongo_doc_id, s.title
FROM Faculty_Submissions s
JOIN User_Auth_Roles u ON u.user_id = s.faculty_id
ORDER BY s.submission_id;

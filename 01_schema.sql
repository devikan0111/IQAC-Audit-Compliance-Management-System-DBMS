-- =====================================================================
-- IQAC Audit & Compliance Management System
-- STEP 2: MySQL DDL  (MySQL 8.0.16+ required, CHECK constraints enforced)
-- Run:  mysql -u root -p < 01_schema.sql
-- =====================================================================

DROP DATABASE IF EXISTS iqac_db;
CREATE DATABASE iqac_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
USE iqac_db;

-- ---------------------------------------------------------------------
-- 1. Departments
-- ---------------------------------------------------------------------
CREATE TABLE Departments (
    dept_id    INT          NOT NULL AUTO_INCREMENT,
    dept_name  VARCHAR(100) NOT NULL,
    dept_code  VARCHAR(10)  NOT NULL,
    CONSTRAINT pk_departments      PRIMARY KEY (dept_id),
    CONSTRAINT uq_dept_name        UNIQUE (dept_name),
    CONSTRAINT uq_dept_code        UNIQUE (dept_code)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. User_Auth_Roles
--    full_name (composite attribute) is split into first_name + last_name
-- ---------------------------------------------------------------------
CREATE TABLE User_Auth_Roles (
    user_id        INT          NOT NULL AUTO_INCREMENT,
    first_name     VARCHAR(50)  NOT NULL,
    last_name      VARCHAR(50)  NOT NULL,
    email          VARCHAR(150) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           ENUM('Faculty','HOD','Auditor','Admin') NOT NULL,
    dept_id        INT          NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_users          PRIMARY KEY (user_id),
    CONSTRAINT uq_users_email    UNIQUE (email),
    CONSTRAINT fk_users_dept     FOREIGN KEY (dept_id)
        REFERENCES Departments (dept_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_users_email   CHECK (email LIKE '%_@_%.__%'),
    -- Faculty and HOD must belong to a department; Auditor/Admin may not
    CONSTRAINT chk_users_dept    CHECK (role IN ('Auditor','Admin') OR dept_id IS NOT NULL)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. Audit_Cycles
-- ---------------------------------------------------------------------
CREATE TABLE Audit_Cycles (
    cycle_id    INT          NOT NULL AUTO_INCREMENT,
    cycle_name  VARCHAR(100) NOT NULL,
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    status      ENUM('Draft','Active','Locked','Archived') NOT NULL DEFAULT 'Draft',
    created_by  INT          NOT NULL,
    CONSTRAINT pk_cycles         PRIMARY KEY (cycle_id),
    CONSTRAINT uq_cycle_name     UNIQUE (cycle_name),
    CONSTRAINT fk_cycles_user    FOREIGN KEY (created_by)
        REFERENCES User_Auth_Roles (user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_cycle_dates   CHECK (end_date > start_date)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. Criteria_Metrics_Master
--    parent_metric_id = self-reference (Criterion 3 -> 3.4 -> 3.4.2)
-- ---------------------------------------------------------------------
CREATE TABLE Criteria_Metrics_Master (
    metric_id        INT           NOT NULL AUTO_INCREMENT,
    parent_metric_id INT           NULL,
    criteria_number  VARCHAR(20)   NOT NULL,
    description      TEXT          NOT NULL,
    metric_type      ENUM('Quantitative','Qualitative') NOT NULL,
    max_score        DECIMAL(5,2)  NOT NULL,
    weightage        DECIMAL(3,2)  NOT NULL,
    target_role      ENUM('Faculty','HOD') NOT NULL,
    CONSTRAINT pk_metrics          PRIMARY KEY (metric_id),
    CONSTRAINT uq_criteria_number  UNIQUE (criteria_number),
    CONSTRAINT fk_metrics_parent   FOREIGN KEY (parent_metric_id)
        REFERENCES Criteria_Metrics_Master (metric_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_metrics_max     CHECK (max_score > 0),
    CONSTRAINT chk_metrics_weight  CHECK (weightage >= 0 AND weightage <= 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. Faculty_Submissions
--    mongo_doc_id links to the flexible evidence document in MongoDB
-- ---------------------------------------------------------------------
CREATE TABLE Faculty_Submissions (
    submission_id  INT           NOT NULL AUTO_INCREMENT,
    faculty_id     INT           NOT NULL,
    metric_id      INT           NOT NULL,
    cycle_id       INT           NOT NULL,
    title          VARCHAR(255)  NOT NULL,
    doi_or_isbn    VARCHAR(100)  NULL,
    evidence_url   VARCHAR(500)  NOT NULL,
    mongo_doc_id   CHAR(24)      NULL,
    score_awarded  DECIMAL(5,2)  NULL,
    status         ENUM('Draft','Submitted','Verified','Approved','Rejected')
                   NOT NULL DEFAULT 'Draft',
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                   ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_fsub            PRIMARY KEY (submission_id),
    CONSTRAINT fk_fsub_faculty    FOREIGN KEY (faculty_id)
        REFERENCES User_Auth_Roles (user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_fsub_metric     FOREIGN KEY (metric_id)
        REFERENCES Criteria_Metrics_Master (metric_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_fsub_cycle      FOREIGN KEY (cycle_id)
        REFERENCES Audit_Cycles (cycle_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- same faculty cannot submit the same DOI/ISBN twice in one cycle
    -- (cross-faculty duplicates are caught by a trigger in Step 5)
    CONSTRAINT uq_fsub_dup        UNIQUE (cycle_id, faculty_id, doi_or_isbn),
    CONSTRAINT chk_fsub_url       CHECK (evidence_url LIKE 'http%'),
    CONSTRAINT chk_fsub_score     CHECK (score_awarded IS NULL OR score_awarded >= 0),
    CONSTRAINT chk_fsub_mongo     CHECK (mongo_doc_id IS NULL
                                         OR mongo_doc_id REGEXP '^[0-9a-f]{24}$')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. Department_Metrics
-- ---------------------------------------------------------------------
CREATE TABLE Department_Metrics (
    dept_metric_id  INT           NOT NULL AUTO_INCREMENT,
    dept_id         INT           NOT NULL,
    hod_id          INT           NOT NULL,
    metric_id       INT           NOT NULL,
    cycle_id        INT           NOT NULL,
    metric_value    DECIMAL(12,2) NOT NULL,
    evidence_url    VARCHAR(500)  NOT NULL,
    mongo_doc_id    CHAR(24)      NULL,
    status          ENUM('Draft','Submitted','Verified','Approved','Rejected')
                    NOT NULL DEFAULT 'Draft',
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_dmet            PRIMARY KEY (dept_metric_id),
    CONSTRAINT fk_dmet_dept       FOREIGN KEY (dept_id)
        REFERENCES Departments (dept_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_dmet_hod        FOREIGN KEY (hod_id)
        REFERENCES User_Auth_Roles (user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_dmet_metric     FOREIGN KEY (metric_id)
        REFERENCES Criteria_Metrics_Master (metric_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_dmet_cycle      FOREIGN KEY (cycle_id)
        REFERENCES Audit_Cycles (cycle_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- a department reports each metric only once per cycle
    CONSTRAINT uq_dmet_once       UNIQUE (dept_id, metric_id, cycle_id),
    CONSTRAINT chk_dmet_value     CHECK (metric_value >= 0),
    CONSTRAINT chk_dmet_url       CHECK (evidence_url LIKE 'http%'),
    CONSTRAINT chk_dmet_mongo     CHECK (mongo_doc_id IS NULL
                                         OR mongo_doc_id REGEXP '^[0-9a-f]{24}$')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. Verification_Logs  (audit trail; rows are never deleted)
--    Exactly one of submission_id / dept_metric_id must be filled.
-- ---------------------------------------------------------------------
CREATE TABLE Verification_Logs (
    log_id             INT          NOT NULL AUTO_INCREMENT,
    submission_id      INT          NULL,
    dept_metric_id     INT          NULL,
    action_by_user_id  INT          NOT NULL,
    previous_status    VARCHAR(20)  NULL,
    new_status         VARCHAR(20)  NOT NULL,
    remarks            TEXT         NULL,
    logged_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_logs            PRIMARY KEY (log_id),
    CONSTRAINT fk_logs_sub        FOREIGN KEY (submission_id)
        REFERENCES Faculty_Submissions (submission_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_logs_dmet       FOREIGN KEY (dept_metric_id)
        REFERENCES Department_Metrics (dept_metric_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_logs_user       FOREIGN KEY (action_by_user_id)
        REFERENCES User_Auth_Roles (user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_logs_target    CHECK ((submission_id IS NULL) + (dept_metric_id IS NULL) = 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. Score_Aggregates  (total_weighted_score is a derived attribute,
--    computed and stored by a stored procedure in Step 5)
-- ---------------------------------------------------------------------
CREATE TABLE Score_Aggregates (
    aggregate_id          INT           NOT NULL AUTO_INCREMENT,
    cycle_id              INT           NOT NULL,
    dept_id               INT           NOT NULL,
    total_weighted_score  DECIMAL(6,2)  NOT NULL,
    generated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_scores          PRIMARY KEY (aggregate_id),
    CONSTRAINT fk_scores_cycle    FOREIGN KEY (cycle_id)
        REFERENCES Audit_Cycles (cycle_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_scores_dept     FOREIGN KEY (dept_id)
        REFERENCES Departments (dept_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT uq_scores_once     UNIQUE (cycle_id, dept_id),
    CONSTRAINT chk_scores_total   CHECK (total_weighted_score >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- INDEXES (InnoDB already indexes every FK column automatically)
-- ---------------------------------------------------------------------
-- Fast DOI/ISBN lookup across all faculty (used by the duplicate-detection
-- trigger in Step 5; the UNIQUE constraint cannot help a DOI-only search)
CREATE INDEX idx_fsub_doi ON Faculty_Submissions (doi_or_isbn);

-- Full-Text Search: lets MySQL find similar titles by word (MATCH ... AGAINST),
-- used to flag possible duplicate submissions
CREATE FULLTEXT INDEX ft_fsub_title ON Faculty_Submissions (title);

-- ---------------------------------------------------------------------
-- Quick verification
-- ---------------------------------------------------------------------
SHOW TABLES;

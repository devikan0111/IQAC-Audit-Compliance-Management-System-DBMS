-- =====================================================================
-- IQAC Audit & Compliance Management System
-- STEP 5b: Triggers (workflow, locking, role checks, duplicates, audit log)
--
-- Run order:  01_schema.sql -> 04_seed_data.sql -> (05_dml_queries.sql) -> THIS FILE
--   inside the mysql client:  source C:/path/to/06_triggers.sql;
--
-- Re-running this file is safe (every object is dropped first).
--
-- HOW THE DATABASE KNOWS "WHO IS DOING THIS"
--   The application sets two session variables on the same connection
--   before it changes data:
--       SET @current_user_id = 5;          -- the logged-in user (required)
--       SET @status_remarks  = 'text';     -- reviewer remarks (needed for Reject)
--   Triggers read them to check the user's role and to fill the audit log.
--
-- WORKFLOW ENFORCED
--   Draft -> Submitted        by the owner (Faculty / HOD)
--   Submitted -> Verified     by the HOD of the faculty's department (faculty items)
--                             by an Auditor                           (department items)
--   Submitted/Verified -> Rejected  needs remarks
--   Verified -> Approved      by an Auditor, faculty items need a score
--   Rejected -> Draft         by the owner (re-open and fix)
--   Approved records and records of a Locked/Archived cycle are frozen.
--   Verification_Logs is append-only.
-- =====================================================================

USE iqac_db;

DROP TRIGGER IF EXISTS trg_fsub_bi;
DROP TRIGGER IF EXISTS trg_fsub_bu;
DROP TRIGGER IF EXISTS trg_fsub_au;
DROP TRIGGER IF EXISTS trg_fsub_bd;
DROP TRIGGER IF EXISTS trg_dmet_bi;
DROP TRIGGER IF EXISTS trg_dmet_bu;
DROP TRIGGER IF EXISTS trg_dmet_au;
DROP TRIGGER IF EXISTS trg_dmet_bd;
DROP TRIGGER IF EXISTS trg_cycle_bi;
DROP TRIGGER IF EXISTS trg_cycle_bu;
DROP TRIGGER IF EXISTS trg_cycle_bd;
DROP TRIGGER IF EXISTS trg_metric_bi;
DROP TRIGGER IF EXISTS trg_metric_ai;
DROP TRIGGER IF EXISTS trg_metric_bu;
DROP TRIGGER IF EXISTS trg_logs_bu;
DROP TRIGGER IF EXISTS trg_logs_bd;
DROP PROCEDURE IF EXISTS sp_check_duplicate;
DROP FUNCTION  IF EXISTS fn_actor_role;
DROP FUNCTION  IF EXISTS fn_actor_dept;

DELIMITER $$

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS: role / department of the user in @current_user_id
-- (return NULL when the variable is unset or the user is inactive)
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_actor_role() RETURNS VARCHAR(10)
READS SQL DATA
BEGIN
    DECLARE v_role VARCHAR(10);
    SELECT role INTO v_role
    FROM   User_Auth_Roles
    WHERE  user_id = @current_user_id AND is_active = TRUE;
    RETURN v_role;
END$$

CREATE FUNCTION fn_actor_dept() RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_dept INT;
    SELECT dept_id INTO v_dept
    FROM   User_Auth_Roles
    WHERE  user_id = @current_user_id AND is_active = TRUE;
    RETURN v_dept;
END$$

-- ---------------------------------------------------------------------
-- DUPLICATE DETECTION (called by the faculty triggers, and usable by the
-- app as a pre-check). Raises an error naming the existing submission.
--   p_exclude = submission to ignore (the row being edited), or NULL.
-- A Rejected submission does not block a new claim.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_check_duplicate(
    IN p_cycle   INT,
    IN p_exclude INT,
    IN p_doi     VARCHAR(100),
    IN p_title   VARCHAR(255))
BEGIN
    DECLARE v_msg VARCHAR(128);
    DECLARE v_dup INT DEFAULT NULL;

    IF p_doi IS NOT NULL THEN
        SELECT submission_id INTO v_dup
        FROM   Faculty_Submissions
        WHERE  cycle_id = p_cycle
          AND  doi_or_isbn = p_doi
          AND  status <> 'Rejected'
          AND  (p_exclude IS NULL OR submission_id <> p_exclude)
        LIMIT 1;
        IF v_dup IS NOT NULL THEN
            SET v_msg = CONCAT('Duplicate DOI/ISBN: already claimed in submission #', v_dup);
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;

    SET v_dup = NULL;
    SELECT submission_id INTO v_dup
    FROM   Faculty_Submissions
    WHERE  cycle_id = p_cycle
      AND  LOWER(TRIM(title)) = LOWER(TRIM(p_title))
      AND  status <> 'Rejected'
      AND  (p_exclude IS NULL OR submission_id <> p_exclude)
    LIMIT 1;
    IF v_dup IS NOT NULL THEN
        SET v_msg = CONCAT('Duplicate title: same work already submitted as #', v_dup);
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END$$


-- #####################################################################
-- FACULTY_SUBMISSIONS
-- #####################################################################

-- BEFORE INSERT: who may create, what it may link to, duplicates ---------
CREATE TRIGGER trg_fsub_bi BEFORE INSERT ON Faculty_Submissions
FOR EACH ROW
BEGIN
    DECLARE v_role     VARCHAR(10);
    DECLARE v_active   BOOLEAN;
    DECLARE v_target   VARCHAR(10);
    DECLARE v_cycle    VARCHAR(10);
    DECLARE v_children INT;

    IF NEW.status <> 'Draft' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'New submissions must start as Draft';
    END IF;
    IF NEW.score_awarded IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A score cannot be set on a new submission';
    END IF;

    SELECT role, is_active INTO v_role, v_active
    FROM   User_Auth_Roles WHERE user_id = NEW.faculty_id;
    IF v_role IS NULL OR v_role <> 'Faculty' OR v_active = FALSE THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an active Faculty user can own a submission';
    END IF;

    IF @current_user_id IS NULL OR @current_user_id <> NEW.faculty_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'You can only create submissions for yourself (set @current_user_id)';
    END IF;

    SELECT target_role INTO v_target
    FROM   Criteria_Metrics_Master WHERE metric_id = NEW.metric_id;
    IF v_target IS NOT NULL AND v_target <> 'Faculty' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'This criterion belongs to HOD metrics, not faculty submissions';
    END IF;

    SELECT COUNT(*) INTO v_children
    FROM   Criteria_Metrics_Master WHERE parent_metric_id = NEW.metric_id;
    IF v_children > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Submissions must link to a leaf criterion (no sub-criteria)';
    END IF;

    SELECT status INTO v_cycle FROM Audit_Cycles WHERE cycle_id = NEW.cycle_id;
    IF v_cycle IS NOT NULL AND v_cycle <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit cycle is not Active';
    END IF;

    CALL sp_check_duplicate(NEW.cycle_id, NULL, NEW.doi_or_isbn, NEW.title);
END$$

-- BEFORE UPDATE: locking, role-based status flow, score rules ------------
CREATE TRIGGER trg_fsub_bu BEFORE UPDATE ON Faculty_Submissions
FOR EACH ROW
BEGIN
    DECLARE v_msg VARCHAR(128);
    DECLARE v_cycle VARCHAR(10);
    DECLARE v_role  VARCHAR(10);
    DECLARE v_adept INT;
    DECLARE v_fdept INT;
    DECLARE v_max   DECIMAL(5,2);

    IF OLD.status = 'Approved' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Approved records are locked and cannot be changed';
    END IF;

    SELECT status INTO v_cycle FROM Audit_Cycles WHERE cycle_id = OLD.cycle_id;
    IF v_cycle IN ('Locked', 'Archived') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'The audit cycle is closed; records cannot be changed';
    END IF;

    IF NEW.submission_id <> OLD.submission_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Submission IDs cannot be changed';
    END IF;
    IF NEW.faculty_id <> OLD.faculty_id OR NEW.cycle_id <> OLD.cycle_id
       OR NEW.metric_id <> OLD.metric_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Owner, cycle and criterion cannot be changed';
    END IF;

    SET v_role  = fn_actor_role();
    SET v_adept = fn_actor_dept();
    IF v_role IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Set @current_user_id to an active user before changing records';
    END IF;

    IF NEW.status = OLD.status THEN
        -- plain edit (no status change)
        IF OLD.status NOT IN ('Draft', 'Rejected') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Record is under review and frozen';
        END IF;
        IF v_role <> 'Faculty' OR @current_user_id <> OLD.faculty_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Only the owner can edit this submission';
        END IF;
        IF NOT (NEW.score_awarded <=> OLD.score_awarded) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A score can only be set when approving';
        END IF;
        IF NOT (NEW.doi_or_isbn <=> OLD.doi_or_isbn) OR NEW.title <> OLD.title THEN
            CALL sp_check_duplicate(OLD.cycle_id, OLD.submission_id, NEW.doi_or_isbn, NEW.title);
        END IF;
    ELSE
        -- status change: check the transition and who is allowed to make it
        IF (OLD.status = 'Draft' AND NEW.status = 'Submitted')
           OR (OLD.status = 'Rejected' AND NEW.status = 'Draft') THEN
            IF v_role <> 'Faculty' OR @current_user_id <> OLD.faculty_id THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Only the owner can submit or re-open this submission';
            END IF;
            CALL sp_check_duplicate(OLD.cycle_id, OLD.submission_id, NEW.doi_or_isbn, NEW.title);

        ELSEIF OLD.status = 'Submitted' AND NEW.status IN ('Verified', 'Rejected') THEN
            SELECT dept_id INTO v_fdept FROM User_Auth_Roles WHERE user_id = OLD.faculty_id;
            IF v_role <> 'HOD' OR v_adept <> v_fdept THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Only the HOD of the faculty''s department can verify or reject';
            END IF;

        ELSEIF OLD.status = 'Verified' AND NEW.status IN ('Approved', 'Rejected') THEN
            IF v_role <> 'Auditor' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Only an Auditor can approve or reject a verified submission';
            END IF;
            IF NEW.status = 'Approved' THEN
                SELECT max_score INTO v_max
                FROM   Criteria_Metrics_Master WHERE metric_id = OLD.metric_id;
                IF NEW.score_awarded IS NULL OR NEW.score_awarded < 0
                   OR NEW.score_awarded > v_max THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'Approval needs a score between 0 and the criterion max score';
                END IF;
            END IF;

        ELSE
            SET v_msg = CONCAT('Invalid status transition: ', OLD.status, ' -> ', NEW.status);
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        IF NEW.status <> 'Approved' AND NOT (NEW.score_awarded <=> OLD.score_awarded) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A score can only be set when approving';
        END IF;
        IF NEW.status = 'Rejected' AND (@status_remarks IS NULL OR TRIM(@status_remarks) = '') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A rejection needs remarks (SET @status_remarks)';
        END IF;
        IF NEW.title <> OLD.title OR NOT (NEW.doi_or_isbn <=> OLD.doi_or_isbn)
           OR NEW.evidence_url <> OLD.evidence_url
           OR NOT (NEW.mongo_doc_id <=> OLD.mongo_doc_id) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Change the status or the content, not both at once';
        END IF;
    END IF;
END$$

-- AFTER UPDATE: automatic, tamper-proof audit log ------------------------
CREATE TRIGGER trg_fsub_au AFTER UPDATE ON Faculty_Submissions
FOR EACH ROW
BEGIN
    IF NEW.status <> OLD.status THEN
        INSERT INTO Verification_Logs
            (submission_id, dept_metric_id, action_by_user_id, previous_status, new_status, remarks)
        VALUES
            (NEW.submission_id, NULL, @current_user_id, OLD.status, NEW.status, @status_remarks);
        SET @status_remarks = NULL;     -- remarks belong to this one action only
    END IF;
END$$

-- BEFORE DELETE: only the owner can withdraw a Draft ---------------------
CREATE TRIGGER trg_fsub_bd BEFORE DELETE ON Faculty_Submissions
FOR EACH ROW
BEGIN
    DECLARE v_cycle VARCHAR(10);
    IF OLD.status <> 'Draft' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only Draft submissions can be deleted';
    END IF;
    IF @current_user_id IS NULL OR @current_user_id <> OLD.faculty_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the owner can delete a draft';
    END IF;
    SELECT status INTO v_cycle FROM Audit_Cycles WHERE cycle_id = OLD.cycle_id;
    IF v_cycle IN ('Locked', 'Archived') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit cycle is closed';
    END IF;
END$$


-- #####################################################################
-- DEPARTMENT_METRICS
-- #####################################################################

CREATE TRIGGER trg_dmet_bi BEFORE INSERT ON Department_Metrics
FOR EACH ROW
BEGIN
    DECLARE v_role     VARCHAR(10);
    DECLARE v_active   BOOLEAN;
    DECLARE v_hdept    INT;
    DECLARE v_target   VARCHAR(10);
    DECLARE v_cycle    VARCHAR(10);
    DECLARE v_children INT;

    IF NEW.status <> 'Draft' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'New department metrics must start as Draft';
    END IF;

    SELECT role, is_active, dept_id INTO v_role, v_active, v_hdept
    FROM   User_Auth_Roles WHERE user_id = NEW.hod_id;
    IF v_role IS NULL OR v_role <> 'HOD' OR v_active = FALSE THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an active HOD can enter department metrics';
    END IF;
    IF v_hdept <> NEW.dept_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'An HOD can only enter metrics for their own department';
    END IF;
    IF @current_user_id IS NULL OR @current_user_id <> NEW.hod_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'You can only enter metrics as yourself (set @current_user_id)';
    END IF;

    SELECT target_role INTO v_target
    FROM   Criteria_Metrics_Master WHERE metric_id = NEW.metric_id;
    IF v_target IS NOT NULL AND v_target <> 'HOD' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'This criterion belongs to faculty submissions, not HOD metrics';
    END IF;
    SELECT COUNT(*) INTO v_children
    FROM   Criteria_Metrics_Master WHERE parent_metric_id = NEW.metric_id;
    IF v_children > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Metrics must link to a leaf criterion (no sub-criteria)';
    END IF;

    SELECT status INTO v_cycle FROM Audit_Cycles WHERE cycle_id = NEW.cycle_id;
    IF v_cycle IS NOT NULL AND v_cycle <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit cycle is not Active';
    END IF;

    IF NEW.metric_value > 100 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'HOD metrics are percentages between 0 and 100';
    END IF;
END$$

CREATE TRIGGER trg_dmet_bu BEFORE UPDATE ON Department_Metrics
FOR EACH ROW
BEGIN
    DECLARE v_msg VARCHAR(128);
    DECLARE v_cycle VARCHAR(10);
    DECLARE v_role  VARCHAR(10);

    IF OLD.status = 'Approved' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Approved records are locked and cannot be changed';
    END IF;

    SELECT status INTO v_cycle FROM Audit_Cycles WHERE cycle_id = OLD.cycle_id;
    IF v_cycle IN ('Locked', 'Archived') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'The audit cycle is closed; records cannot be changed';
    END IF;

    IF NEW.dept_metric_id <> OLD.dept_metric_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Department metric IDs cannot be changed';
    END IF;
    IF NEW.hod_id <> OLD.hod_id OR NEW.dept_id <> OLD.dept_id
       OR NEW.cycle_id <> OLD.cycle_id OR NEW.metric_id <> OLD.metric_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'HOD, department, cycle and criterion cannot be changed';
    END IF;

    SET v_role = fn_actor_role();
    IF v_role IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Set @current_user_id to an active user before changing records';
    END IF;
    IF NEW.metric_value > 100 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'HOD metrics are percentages between 0 and 100';
    END IF;

    IF NEW.status = OLD.status THEN
        IF OLD.status NOT IN ('Draft', 'Rejected') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Record is under review and frozen';
        END IF;
        IF v_role <> 'HOD' OR @current_user_id <> OLD.hod_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the owning HOD can edit this metric';
        END IF;
    ELSE
        IF (OLD.status = 'Draft' AND NEW.status = 'Submitted')
           OR (OLD.status = 'Rejected' AND NEW.status = 'Draft') THEN
            IF v_role <> 'HOD' OR @current_user_id <> OLD.hod_id THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Only the owning HOD can submit or re-open this metric';
            END IF;
        ELSEIF (OLD.status = 'Submitted' AND NEW.status IN ('Verified', 'Rejected'))
               OR (OLD.status = 'Verified' AND NEW.status IN ('Approved', 'Rejected')) THEN
            IF v_role <> 'Auditor' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Only an Auditor can verify, approve or reject department metrics';
            END IF;
        ELSE
            SET v_msg = CONCAT('Invalid status transition: ', OLD.status, ' -> ', NEW.status);
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        IF NEW.status = 'Rejected' AND (@status_remarks IS NULL OR TRIM(@status_remarks) = '') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A rejection needs remarks (SET @status_remarks)';
        END IF;
        IF NEW.metric_value <> OLD.metric_value OR NEW.evidence_url <> OLD.evidence_url
           OR NOT (NEW.mongo_doc_id <=> OLD.mongo_doc_id) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Change the status or the content, not both at once';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_dmet_au AFTER UPDATE ON Department_Metrics
FOR EACH ROW
BEGIN
    IF NEW.status <> OLD.status THEN
        INSERT INTO Verification_Logs
            (submission_id, dept_metric_id, action_by_user_id, previous_status, new_status, remarks)
        VALUES
            (NULL, NEW.dept_metric_id, @current_user_id, OLD.status, NEW.status, @status_remarks);
        SET @status_remarks = NULL;
    END IF;
END$$

CREATE TRIGGER trg_dmet_bd BEFORE DELETE ON Department_Metrics
FOR EACH ROW
BEGIN
    DECLARE v_cycle VARCHAR(10);
    SELECT status INTO v_cycle FROM Audit_Cycles WHERE cycle_id = OLD.cycle_id;
    IF v_cycle IN ('Locked', 'Archived') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit cycle is closed';
    END IF;
    IF OLD.status <> 'Draft' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only Draft department metrics can be deleted';
    END IF;
    IF @current_user_id IS NULL OR @current_user_id <> OLD.hod_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the owning HOD can delete a draft';
    END IF;
END$$


-- #####################################################################
-- AUDIT_CYCLES  (Draft -> Active -> Locked -> Archived, forward only)
-- #####################################################################

CREATE TRIGGER trg_cycle_bi BEFORE INSERT ON Audit_Cycles
FOR EACH ROW
BEGIN
    DECLARE v_role VARCHAR(10);
    IF NEW.status <> 'Draft' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A new audit cycle must start as Draft';
    END IF;
    SET v_role = fn_actor_role();
    IF v_role IS NULL OR v_role NOT IN ('Auditor', 'Admin') OR @current_user_id <> NEW.created_by THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only an Auditor or Admin can create an audit cycle (as themselves)';
    END IF;
END$$

CREATE TRIGGER trg_cycle_bu BEFORE UPDATE ON Audit_Cycles
FOR EACH ROW
BEGIN
    DECLARE v_msg VARCHAR(128);
    DECLARE v_role    VARCHAR(10);
    DECLARE v_pending INT;

    SET v_role = fn_actor_role();
    IF v_role IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Set @current_user_id to an active user before changing records';
    END IF;

    IF NEW.status = OLD.status THEN
        IF OLD.status <> 'Draft' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cycle settings are frozen once the cycle is Active';
        END IF;
        IF v_role NOT IN ('Auditor', 'Admin') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Only an Auditor or Admin can edit an audit cycle';
        END IF;
    ELSE
        IF OLD.status = 'Draft' AND NEW.status = 'Active' THEN
            IF v_role NOT IN ('Auditor', 'Admin') THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Only an Auditor or Admin can activate a cycle';
            END IF;

        ELSEIF OLD.status = 'Active' AND NEW.status = 'Locked' THEN
            IF v_role <> 'Admin' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an Admin can lock a cycle';
            END IF;
            SELECT (SELECT COUNT(*) FROM Faculty_Submissions
                    WHERE cycle_id = OLD.cycle_id AND status IN ('Submitted', 'Verified'))
                 + (SELECT COUNT(*) FROM Department_Metrics
                    WHERE cycle_id = OLD.cycle_id AND status IN ('Submitted', 'Verified'))
            INTO v_pending;
            IF v_pending > 0 THEN
                SET v_msg = CONCAT('Cannot lock: ', v_pending, ' item(s) are still under review');
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
            END IF;

        ELSEIF OLD.status = 'Locked' AND NEW.status = 'Archived' THEN
            IF v_role <> 'Admin' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an Admin can archive a cycle';
            END IF;

        ELSE
            SET v_msg = CONCAT('Invalid cycle transition: ', OLD.status, ' -> ', NEW.status);
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        IF NEW.cycle_name <> OLD.cycle_name OR NEW.start_date <> OLD.start_date
           OR NEW.end_date <> OLD.end_date THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Change the status or the settings, not both at once';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_cycle_bd BEFORE DELETE ON Audit_Cycles
FOR EACH ROW
BEGIN
    IF OLD.status <> 'Draft' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only a Draft audit cycle can be deleted';
    END IF;
END$$


-- #####################################################################
-- CRITERIA_METRICS_MASTER  (hierarchy integrity + scoring-rule protection)
-- #####################################################################

CREATE TRIGGER trg_metric_bi BEFORE INSERT ON Criteria_Metrics_Master
FOR EACH ROW
BEGIN
    DECLARE v_role  VARCHAR(10);
    DECLARE v_prole VARCHAR(10);

    SET v_role = fn_actor_role();
    IF v_role IS NULL OR v_role NOT IN ('Auditor', 'Admin') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only an Auditor or Admin can define criteria';
    END IF;

    IF NEW.parent_metric_id IS NOT NULL THEN
        SELECT target_role INTO v_prole
        FROM   Criteria_Metrics_Master WHERE metric_id = NEW.parent_metric_id;
        IF v_prole IS NOT NULL AND v_prole <> NEW.target_role THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A criterion must have the same target role as its parent';
        END IF;
        IF EXISTS (SELECT 1 FROM Faculty_Submissions WHERE metric_id = NEW.parent_metric_id)
           OR EXISTS (SELECT 1 FROM Department_Metrics WHERE metric_id = NEW.parent_metric_id) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The parent criterion already has records attached to it';
        END IF;
    END IF;
END$$

-- AFTER INSERT sees the final generated ID. SIGNAL rejects the InnoDB insert.
CREATE TRIGGER trg_metric_ai AFTER INSERT ON Criteria_Metrics_Master
FOR EACH ROW
BEGIN
    IF NEW.parent_metric_id = NEW.metric_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A criterion cannot be its own parent';
    END IF;
END$$

CREATE TRIGGER trg_metric_bu BEFORE UPDATE ON Criteria_Metrics_Master
FOR EACH ROW
BEGIN
    DECLARE v_loop INT DEFAULT 0;

    IF NEW.metric_id <> OLD.metric_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Metric IDs cannot be changed';
    END IF;

    IF fn_actor_role() IS NULL OR fn_actor_role() NOT IN ('Auditor', 'Admin') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only an Auditor or Admin can change criteria';
    END IF;

    IF NEW.parent_metric_id IS NOT NULL THEN
        IF NEW.parent_metric_id = OLD.metric_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A criterion cannot be its own parent';
        END IF;

        -- the new parent must not be one of this criterion's own descendants
        WITH RECURSIVE descendants AS (
            SELECT metric_id FROM Criteria_Metrics_Master
            WHERE  parent_metric_id = OLD.metric_id
          UNION ALL
            SELECT c.metric_id FROM Criteria_Metrics_Master c
            JOIN   descendants d ON c.parent_metric_id = d.metric_id
        )
        SELECT COUNT(*) INTO v_loop FROM descendants
        WHERE  metric_id = NEW.parent_metric_id;
        IF v_loop > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Invalid parent: it would create a loop in the criteria tree';
        END IF;
    END IF;

    IF NEW.weightage <> OLD.weightage OR NEW.max_score <> OLD.max_score
       OR NEW.target_role <> OLD.target_role THEN
        IF EXISTS (SELECT 1 FROM Faculty_Submissions
                   WHERE metric_id = OLD.metric_id AND status = 'Approved')
           OR EXISTS (SELECT 1 FROM Department_Metrics
                      WHERE metric_id = OLD.metric_id AND status = 'Approved') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Approved records already use this criterion; scoring rules are frozen';
        END IF;
    END IF;
END$$


-- #####################################################################
-- VERIFICATION_LOGS  (append-only audit trail)
-- #####################################################################

CREATE TRIGGER trg_logs_bu BEFORE UPDATE ON Verification_Logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Verification_Logs is append-only: log entries cannot be modified';
END$$

CREATE TRIGGER trg_logs_bd BEFORE DELETE ON Verification_Logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Verification_Logs is append-only: log entries cannot be deleted';
END$$

DELIMITER ;

-- ---------------------------------------------------------------------
-- Quick verification
-- ---------------------------------------------------------------------
SELECT TRIGGER_NAME, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS on_table, ACTION_TIMING AS timing
FROM   information_schema.TRIGGERS
WHERE  TRIGGER_SCHEMA = 'iqac_db'
ORDER  BY EVENT_OBJECT_TABLE, ACTION_TIMING DESC, EVENT_MANIPULATION;

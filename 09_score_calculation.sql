-- IQAC departmental scoring policy (project/demo policy, not an official NAAC formula).
-- Run after 06_triggers.sql. Uses the existing Score_Aggregates table.
-- Role: active Auditor or Admin, identified by trusted @current_user_id.
-- Transaction ownership stays with the caller. No COMMIT/START TRANSACTION here.
--
-- Only approved LEAF records count. Leaf weights across both target roles must
-- sum to 1.00. Parent criteria are excluded to prevent double counting.
-- Faculty leaf raw score: MIN(SUM(approved scores in department), max_score).
-- HOD leaf raw score: metric_value / 100 * max_score.
-- Leaf contribution: raw_score / max_score * weightage * 100.
-- Missing leaves contribute zero; missing weights are never redistributed.
-- Departments with no approved records receive 0.00. Repeated calls update the
-- same (cycle_id,dept_id) aggregate instead of inserting duplicate totals.
--
-- Manual demo (caller-owned transaction):
-- SET @current_user_id=2;
-- START TRANSACTION;
-- CALL sp_recalculate_scores(1);
-- COMMIT;
-- SET @current_user_id=NULL;
-- SELECT * FROM Score_Aggregates WHERE cycle_id=1;
--
-- Original seed expected totals: CSE 31.25, ECE 19.50, ME 0.00.
USE iqac_db;
DROP PROCEDURE IF EXISTS sp_recalculate_scores;
DELIMITER $$
CREATE PROCEDURE sp_recalculate_scores(IN p_cycle_id INT)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
    DECLARE v_role VARCHAR(10);
    DECLARE v_cycle VARCHAR(10) DEFAULT NULL;
    DECLARE v_weight DECIMAL(10,4) DEFAULT 0;

    SET v_role=fn_actor_role();
    IF v_role IS NULL OR v_role NOT IN ('Auditor','Admin') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT='Only an active Auditor or Admin can recalculate scores';
    END IF;
    IF p_cycle_id IS NULL OR p_cycle_id<=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A valid audit cycle is required';
    END IF;

    -- Serializes score refresh with approval/locking in the portal transaction.
    SELECT status INTO v_cycle FROM Audit_Cycles
    WHERE cycle_id=p_cycle_id FOR UPDATE;
    IF v_cycle IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Audit cycle not found';
    END IF;
    IF v_cycle NOT IN ('Active','Locked') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT='Scores can only be refreshed for Active or Locked cycles';
    END IF;

    SELECT COALESCE(SUM(m.weightage),0) INTO v_weight
    FROM Criteria_Metrics_Master m
    WHERE NOT EXISTS(
        SELECT 1 FROM Criteria_Metrics_Master child
        WHERE child.parent_metric_id=m.metric_id
    );
    IF ABS(v_weight-1.0000)>0.0001 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT='Leaf metric weights must sum to 1.00 before scoring';
    END IF;

    -- Reject invalid legacy/seed values rather than silently producing a total.
    IF EXISTS(
        SELECT 1 FROM Faculty_Submissions s
        JOIN Criteria_Metrics_Master m ON m.metric_id=s.metric_id
        WHERE s.cycle_id=p_cycle_id AND s.status='Approved'
          AND (s.score_awarded IS NULL OR s.score_awarded<0
               OR s.score_awarded>m.max_score OR m.target_role<>'Faculty'
               OR EXISTS(SELECT 1 FROM Criteria_Metrics_Master child
                         WHERE child.parent_metric_id=m.metric_id))
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT='An approved faculty record has an invalid score or criterion';
    END IF;
    IF EXISTS(
        SELECT 1 FROM Department_Metrics dm
        JOIN Criteria_Metrics_Master m ON m.metric_id=dm.metric_id
        WHERE dm.cycle_id=p_cycle_id AND dm.status='Approved'
          AND (dm.metric_value<0 OR dm.metric_value>100 OR m.target_role<>'HOD'
               OR EXISTS(SELECT 1 FROM Criteria_Metrics_Master child
                         WHERE child.parent_metric_id=m.metric_id))
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT='An approved department record has an invalid value or criterion';
    END IF;

    INSERT INTO Score_Aggregates
        (cycle_id,dept_id,total_weighted_score,generated_at)
    SELECT p_cycle_id,d.dept_id,
           ROUND(SUM(
               CASE WHEN m.target_role='Faculty'
                    THEN LEAST(COALESCE(f.total_score,0),m.max_score)/m.max_score
                    ELSE COALESCE(dm.metric_value,0)/100
               END * m.weightage * 100
           ),2),
           CURRENT_TIMESTAMP
    FROM Departments d
    CROSS JOIN Criteria_Metrics_Master m
    LEFT JOIN (
        SELECT u.dept_id,s.metric_id,SUM(s.score_awarded) AS total_score
        FROM Faculty_Submissions s
        JOIN User_Auth_Roles u ON u.user_id=s.faculty_id
        WHERE s.cycle_id=p_cycle_id AND s.status='Approved'
        GROUP BY u.dept_id,s.metric_id
    ) f ON f.dept_id=d.dept_id AND f.metric_id=m.metric_id
    LEFT JOIN Department_Metrics dm
           ON dm.dept_id=d.dept_id AND dm.metric_id=m.metric_id
          AND dm.cycle_id=p_cycle_id AND dm.status='Approved'
    WHERE NOT EXISTS(
        SELECT 1 FROM Criteria_Metrics_Master child
        WHERE child.parent_metric_id=m.metric_id
    )
    GROUP BY d.dept_id
    ON DUPLICATE KEY UPDATE
        total_weighted_score=VALUES(total_weighted_score),
        generated_at=CURRENT_TIMESTAMP;
END$$
DELIMITER ;

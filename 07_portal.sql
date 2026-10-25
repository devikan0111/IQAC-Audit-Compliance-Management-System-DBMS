-- Run after schema, seed, optional DML demos, and 06_triggers.sql.
USE iqac_db;
CREATE TABLE IF NOT EXISTS Portal_Sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL,
 expires_at DATETIME NOT NULL,
 FOREIGN KEY (user_id) REFERENCES User_Auth_Roles(user_id) ON DELETE CASCADE,
 INDEX idx_session_expiry(expires_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS Portal_Login_Attempts (
 email VARCHAR(150) PRIMARY KEY, attempts INT NOT NULL DEFAULT 0,
 window_started DATETIME NOT NULL
) ENGINE=InnoDB;
-- Durable, ordered evidence projection. MySQL commits first; failed Mongo writes
-- remain queued. Run npm run evidence:sync after restoring MongoDB.
CREATE TABLE IF NOT EXISTS Evidence_Outbox (
 outbox_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 collection_name ENUM('faculty_evidence','department_evidence') NOT NULL,
 mongo_id CHAR(24) NOT NULL, operation ENUM('replace','delete') NOT NULL,
 payload JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TIMESTAMP NULL, last_error VARCHAR(500) NULL,
 INDEX idx_outbox_pending(processed_at,outbox_id)
) ENGINE=InnoDB;

-- Tighten simple gaps from the original triggers without changing the schema.
DROP TRIGGER IF EXISTS trg_portal_cycle_delete;
DROP TRIGGER IF EXISTS trg_portal_fsub_delete;
DROP TRIGGER IF EXISTS trg_portal_dmet_delete;
DELIMITER $$
CREATE TRIGGER trg_portal_cycle_delete BEFORE DELETE ON Audit_Cycles
FOR EACH ROW BEGIN
 IF fn_actor_role() IS NULL OR fn_actor_role() NOT IN ('Admin','Auditor') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Only Admin or Auditor may delete Draft cycles';
 END IF;
END$$
CREATE TRIGGER trg_portal_fsub_delete BEFORE DELETE ON Faculty_Submissions
FOR EACH ROW BEGIN
 IF fn_actor_role() IS NULL OR fn_actor_role()<>'Faculty' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='An active Faculty owner is required';
 END IF;
END$$
CREATE TRIGGER trg_portal_dmet_delete BEFORE DELETE ON Department_Metrics
FOR EACH ROW BEGIN
 IF fn_actor_role() IS NULL OR fn_actor_role()<>'HOD' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='An active HOD owner is required';
 END IF;
END$$
DELIMITER ;

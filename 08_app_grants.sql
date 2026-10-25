-- Run as DBA after replacing the password below. Web app must NOT use root.
-- This account is a trusted backend account, never handed to end users.
CREATE USER IF NOT EXISTS 'iqac_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
GRANT SELECT ON iqac_db.* TO 'iqac_app'@'localhost';
GRANT INSERT, UPDATE, DELETE ON iqac_db.Faculty_Submissions TO 'iqac_app'@'localhost';
GRANT INSERT, UPDATE, DELETE ON iqac_db.Department_Metrics TO 'iqac_app'@'localhost';
GRANT INSERT, UPDATE ON iqac_db.Audit_Cycles TO 'iqac_app'@'localhost';
GRANT UPDATE(password_hash) ON iqac_db.User_Auth_Roles TO 'iqac_app'@'localhost';
GRANT INSERT, UPDATE, DELETE ON iqac_db.Portal_Sessions TO 'iqac_app'@'localhost';
GRANT INSERT, UPDATE, DELETE ON iqac_db.Portal_Login_Attempts TO 'iqac_app'@'localhost';
GRANT INSERT, UPDATE ON iqac_db.Evidence_Outbox TO 'iqac_app'@'localhost';
GRANT EXECUTE ON PROCEDURE iqac_db.sp_check_duplicate TO 'iqac_app'@'localhost';
GRANT EXECUTE ON FUNCTION iqac_db.fn_actor_role TO 'iqac_app'@'localhost';
GRANT EXECUTE ON FUNCTION iqac_db.fn_actor_dept TO 'iqac_app'@'localhost';
-- No direct INSERT/UPDATE/DELETE privilege on Verification_Logs: definer triggers
-- append the audit entries. SQL session actor IDs are set only by trusted backend.

GRANT EXECUTE ON PROCEDURE iqac_db.sp_recalculate_scores TO 'iqac_app'@'localhost';

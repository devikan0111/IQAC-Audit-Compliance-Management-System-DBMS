-- IQAC statistics: read-only administrator demo, not an app authorization boundary.
-- No migration, seed reset or score refresh occurs here.
USE iqac_db;
SET @statistics_cycle_id=1;

-- statuses
SELECT kind,status,COUNT(*) AS count FROM (SELECT 'faculty' AS kind,f.status,u.dept_id FROM Faculty_Submissions f JOIN User_Auth_Roles u ON u.user_id=f.faculty_id WHERE f.cycle_id=@statistics_cycle_id UNION ALL SELECT 'department' AS kind,r.status,r.dept_id FROM Department_Metrics r WHERE r.cycle_id=@statistics_cycle_id) records GROUP BY kind,status;

-- pending
SELECT d.dept_id,d.dept_code,d.dept_name,r.kind,r.status,COUNT(r.status) AS count FROM Departments d LEFT JOIN (SELECT 'faculty' AS kind,f.status,u.dept_id FROM Faculty_Submissions f JOIN User_Auth_Roles u ON u.user_id=f.faculty_id WHERE f.cycle_id=@statistics_cycle_id UNION ALL SELECT 'department' AS kind,r.status,r.dept_id FROM Department_Metrics r WHERE r.cycle_id=@statistics_cycle_id) r ON r.dept_id=d.dept_id AND r.status IN ('Submitted','Verified') GROUP BY d.dept_id,d.dept_code,d.dept_name,r.kind,r.status ORDER BY d.dept_code,r.kind,r.status;

-- monthly
SELECT DATE_FORMAT(f.created_at,'%Y-%m') AS month,COUNT(*) AS count FROM Faculty_Submissions f JOIN User_Auth_Roles u ON u.user_id=f.faculty_id WHERE f.cycle_id=@statistics_cycle_id GROUP BY month ORDER BY month;

-- scores
SELECT d.dept_id,d.dept_code,d.dept_name,a.total_weighted_score,a.generated_at FROM Departments d LEFT JOIN Score_Aggregates a ON a.dept_id=d.dept_id AND a.cycle_id=@statistics_cycle_id ORDER BY a.total_weighted_score IS NULL,a.total_weighted_score DESC,d.dept_code;

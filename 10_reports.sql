-- IQAC evaluation reports: read-only, cycle-specific queries.
USE iqac_db;
SET @report_cycle_id=1;

-- Approved submissions by department
SELECT d.dept_id,d.dept_code,d.dept_name,
 COUNT(s.submission_id) AS approved_submissions,
 COUNT(DISTINCT s.faculty_id) AS contributing_faculty,
 COALESCE(SUM(s.score_awarded),0) AS awarded_points
 FROM Departments d
 LEFT JOIN User_Auth_Roles u ON u.dept_id=d.dept_id AND u.role='Faculty'
 LEFT JOIN Faculty_Submissions s ON s.faculty_id=u.user_id
   AND s.cycle_id=@report_cycle_id AND s.status='Approved'

 GROUP BY d.dept_id,d.dept_code,d.dept_name
 ORDER BY approved_submissions DESC,d.dept_code;

-- Pending review by department
SELECT d.dept_id,d.dept_code,d.dept_name,
 COALESCE(f.waiting_for_hod,0) AS waiting_for_hod,
 COALESCE(f.waiting_for_auditor,0)+COALESCE(dm.waiting_for_auditor,0) AS waiting_for_auditor,
 COALESCE(f.waiting_for_hod,0)+COALESCE(f.waiting_for_auditor,0)+COALESCE(dm.waiting_for_auditor,0) AS pending_total
 FROM Departments d
 LEFT JOIN (
   SELECT u.dept_id,
     SUM(s.status='Submitted') AS waiting_for_hod,
     SUM(s.status='Verified') AS waiting_for_auditor
   FROM Faculty_Submissions s
   JOIN User_Auth_Roles u ON u.user_id=s.faculty_id
   WHERE s.cycle_id=@report_cycle_id AND s.status IN ('Submitted','Verified')
   GROUP BY u.dept_id
 ) f ON f.dept_id=d.dept_id
 LEFT JOIN (
   SELECT dept_id,COUNT(*) AS waiting_for_auditor
   FROM Department_Metrics
   WHERE cycle_id=@report_cycle_id AND status IN ('Submitted','Verified')
   GROUP BY dept_id
 ) dm ON dm.dept_id=d.dept_id

 ORDER BY pending_total DESC,d.dept_code;

-- Weighted department scores
SELECT d.dept_id,d.dept_code,d.dept_name,
 a.total_weighted_score,a.generated_at
 FROM Departments d
 LEFT JOIN Score_Aggregates a ON a.dept_id=d.dept_id AND a.cycle_id=@report_cycle_id

 ORDER BY a.total_weighted_score IS NULL,a.total_weighted_score DESC,d.dept_code;

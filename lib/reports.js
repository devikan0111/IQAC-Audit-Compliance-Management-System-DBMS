import {assert,integer} from './policy.js';

// Fixed SQL fragments only; all caller-supplied values remain bound parameters.
export function reportQueries(user,cycleId){
 const cycle=integer(cycleId,'Cycle');
 assert(['Faculty','HOD','Auditor','Admin'].includes(user.role),'Access denied',403);
 const scoped=['Faculty','HOD'].includes(user.role);
 if(scoped)integer(user.dept_id,'Department');
 const where=scoped?'WHERE d.dept_id=?':'';
 const suffix=scoped?[user.dept_id]:[];
 return {
 approved:{
 sql: `SELECT d.dept_id,d.dept_code,d.dept_name,
 COUNT(s.submission_id) AS approved_submissions,
 COUNT(DISTINCT s.faculty_id) AS contributing_faculty,
 COALESCE(SUM(s.score_awarded),0) AS awarded_points
 FROM Departments d
 LEFT JOIN User_Auth_Roles u ON u.dept_id=d.dept_id AND u.role='Faculty'
 LEFT JOIN Faculty_Submissions s ON s.faculty_id=u.user_id
   AND s.cycle_id=? AND s.status='Approved'
 ${where}
 GROUP BY d.dept_id,d.dept_code,d.dept_name
 ORDER BY approved_submissions DESC,d.dept_code`,
 params:[cycle,...suffix]
 },
 pending:{
 sql: `SELECT d.dept_id,d.dept_code,d.dept_name,
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
   WHERE s.cycle_id=? AND s.status IN ('Submitted','Verified')
   GROUP BY u.dept_id
 ) f ON f.dept_id=d.dept_id
 LEFT JOIN (
   SELECT dept_id,COUNT(*) AS waiting_for_auditor
   FROM Department_Metrics
   WHERE cycle_id=? AND status IN ('Submitted','Verified')
   GROUP BY dept_id
 ) dm ON dm.dept_id=d.dept_id
 ${where}
 ORDER BY pending_total DESC,d.dept_code`,
 params:[cycle,cycle,...suffix]
 },
 scores:{
 sql: `SELECT d.dept_id,d.dept_code,d.dept_name,
 a.total_weighted_score,a.generated_at
 FROM Departments d
 LEFT JOIN Score_Aggregates a ON a.dept_id=d.dept_id AND a.cycle_id=?
 ${where}
 ORDER BY a.total_weighted_score IS NULL,a.total_weighted_score DESC,d.dept_code`,
 params:[cycle,...suffix]
 }
 };
}
export const reportDefinitions={
 approved:{title:'Approved submissions by department',columns:[['dept_code','Department'],['dept_name','Department name'],['approved_submissions','Approved submissions'],['contributing_faculty','Contributing faculty'],['awarded_points','Awarded points']]},
 pending:{title:'Pending review by department',columns:[['dept_code','Department'],['dept_name','Department name'],['waiting_for_hod','Waiting for HOD'],['waiting_for_auditor','Waiting for Auditor'],['pending_total','Total pending']]},
 scores:{title:'Weighted department scores',columns:[['dept_code','Department'],['dept_name','Department name'],['total_weighted_score','Score out of 100'],['generated_at','Last calculated']]}
};
export function reportCsv(kind,rows){
 const definition=reportDefinitions[kind];assert(definition,'Unknown report');
 const escape=value=>{
  const raw=value===null||value===undefined?'Not calculated':String(value);
  const safe=/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replaceAll('"','""')+'"';
 };
 return [definition.columns.map(([,label])=>escape(label)).join(','),...rows.map(row=>definition.columns.map(([key])=>escape(row[key])).join(','))].join('\r\n');
}

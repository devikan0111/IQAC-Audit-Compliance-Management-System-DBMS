import {assert,integer} from './policy.js';
export const STATUSES=['Draft','Submitted','Verified','Approved','Rejected'];
export function statisticsFilters(user,input={}){
 assert(['Faculty','HOD','Auditor','Admin'].includes(user.role),'Access denied',403);
 const cycleId=integer(input.cycle_id,'Cycle');
 const kind=input.kind??'all';assert(['all','faculty','department'].includes(kind),'Unknown record type');
 const local=['Faculty','HOD'].includes(user.role);
 const ownDept=local?integer(user.dept_id,'Department'):null;
 const deptId=input.dept_id===undefined||input.dept_id===null||input.dept_id===''?ownDept:integer(input.dept_id,'Department');
 if(local)assert(deptId===ownDept,'You cannot view another department',403);
 if(user.role==='Faculty'){integer(user.user_id,'User');assert(kind!=='department','Faculty cannot view department metrics',403);}
 return {cycleId,deptId,kind:user.role==='Faculty'?'faculty':kind,scope:user.role==='Faculty'?'own':user.role==='HOD'?'department':'institution'};
}
// Only fixed SQL is interpolated. User-supplied IDs remain bound parameters.
export function statisticsQueries(user,input={}){
 const filters=statisticsFilters(user,input),{cycleId,deptId,kind}=filters;
 const fw=['f.cycle_id=?'],fp=[cycleId],dw=['r.cycle_id=?'],dp=[cycleId];
 if(deptId!==null){fw.push('u.dept_id=?');fp.push(deptId);dw.push('r.dept_id=?');dp.push(deptId);}
 if(user.role==='Faculty'){fw.push('f.faculty_id=?');fp.push(user.user_id);}
 const faculty="SELECT 'faculty' AS kind,f.status,u.dept_id FROM Faculty_Submissions f JOIN User_Auth_Roles u ON u.user_id=f.faculty_id WHERE "+fw.join(' AND ');
 const department="SELECT 'department' AS kind,r.status,r.dept_id FROM Department_Metrics r WHERE "+dw.join(' AND ');
 const parts=[],params=[];
 if(kind!=='department'){parts.push(faculty);params.push(...fp);}
 if(kind!=='faculty'&&user.role!=='Faculty'){parts.push(department);params.push(...dp);}
 const records=parts.join(' UNION ALL ');
 const deptWhere=deptId===null?'':' WHERE d.dept_id=?',deptParams=deptId===null?[]:[deptId];
 return {filters,
 statuses:{sql:'SELECT kind,status,COUNT(*) AS count FROM ('+records+') records GROUP BY kind,status',params:[...params]},
 pending:{sql:"SELECT d.dept_id,d.dept_code,d.dept_name,r.kind,r.status,COUNT(r.status) AS count FROM Departments d LEFT JOIN ("+records+") r ON r.dept_id=d.dept_id AND r.status IN ('Submitted','Verified')"+deptWhere+' GROUP BY d.dept_id,d.dept_code,d.dept_name,r.kind,r.status ORDER BY d.dept_code,r.kind,r.status',params:[...params,...deptParams]},
 monthly:kind==='department'?null:{sql:"SELECT DATE_FORMAT(f.created_at,'%Y-%m') AS month,COUNT(*) AS count FROM Faculty_Submissions f JOIN User_Auth_Roles u ON u.user_id=f.faculty_id WHERE "+fw.join(' AND ')+' GROUP BY month ORDER BY month',params:[...fp]},
 scores:user.role==='Faculty'?null:{sql:'SELECT d.dept_id,d.dept_code,d.dept_name,a.total_weighted_score,a.generated_at FROM Departments d LEFT JOIN Score_Aggregates a ON a.dept_id=d.dept_id AND a.cycle_id=?'+deptWhere+' ORDER BY a.total_weighted_score IS NULL,a.total_weighted_score DESC,d.dept_code',params:[cycleId,...deptParams]},
 departments:{sql:'SELECT d.dept_id,d.dept_code,d.dept_name FROM Departments d'+(['Faculty','HOD'].includes(user.role)?' WHERE d.dept_id=?':'')+' ORDER BY d.dept_code',params:['Faculty','HOD'].includes(user.role)?[user.dept_id]:[]}
 };
}
function zeroCounts(){return Object.fromEntries(STATUSES.map(s=>[s,0]));}
export function statisticsResult(filters,cycle,rows){
 const counts=zeroCounts(),byKind={faculty:zeroCounts(),department:zeroCounts()};
 for(const r of rows.statuses){const n=Number(r.count);counts[r.status]+=n;byKind[r.kind][r.status]+=n;}
 const total=Object.values(counts).reduce((a,b)=>a+b,0);
 const departments=rows.departments.map(d=>({...d}));
 const selectedDepartments=filters.deptId?departments.filter(d=>Number(d.dept_id)===Number(filters.deptId)):departments;
 const backlog=new Map(selectedDepartments.map(d=>[Number(d.dept_id),{...d,waiting_for_hod:0,waiting_for_auditor:0,total:0,groups:[]}]));
 for(const r of rows.pending){if(!r.kind||!r.status)continue;const b=backlog.get(Number(r.dept_id)),n=Number(r.count);if(!b)continue;
 const stage=r.kind==='faculty'&&r.status==='Submitted'?'waiting_for_hod':'waiting_for_auditor';b[stage]+=n;b.total+=n;b.groups.push({kind:r.kind,status:r.status,count:n,stage});}
 return {filters,cycle,departments,summary:{total,counts,pending:counts.Submitted+counts.Verified,approvalPercentage:total?Math.round(counts.Approved/total*1000)/10:null},byKind,
 backlog:[...backlog.values()].sort((a,b)=>b.total-a.total||a.dept_code.localeCompare(b.dept_code)),
 monthly:rows.monthly?.map(r=>({month:r.month,count:Number(r.count)}))??null,
 scores:rows.scores?.map(r=>({...r,total_weighted_score:r.total_weighted_score===null?null:Number(r.total_weighted_score)}))??null,
 generatedAt:new Date().toISOString()};
}
// Shared by the register and navigation tests: chart links preserve exact scope.
export function matchesRegister(row,filters={}){
 return (!filters.cycleId||Number(row.cycle_id)===Number(filters.cycleId))&&
 (!filters.deptId||Number(row.dept_id)===Number(filters.deptId))&&
 (!filters.statuses?.length||filters.statuses.includes(row.status))&&
 (!filters.createdMonth||String(row.created_at).slice(0,7)===filters.createdMonth);
}
export function reviewTargets(user,result){
 const groups=result.backlog.flatMap(d=>d.groups.map(g=>({...g,deptId:d.dept_id,deptCode:d.dept_code})));
 if(result.cycle.status!=='Active')return [];
 if(user.role==='HOD')return groups.filter(g=>g.kind==='faculty'&&g.status==='Submitted');
 if(user.role==='Auditor')return groups.filter(g=>g.stage==='waiting_for_auditor');
 return [];
}

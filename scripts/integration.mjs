// Run ONLY against the seeded disposable demo environment. Leaves tagged faculty and department
// Approved records and their audit trails so reviewers can inspect the result.
import assert from 'node:assert/strict';
const base=process.env.TEST_ORIGIN??'http://localhost:3000';
const marker='Integration '+Date.now(),password=process.env.TEST_PASSWORD??'Pass@123';
function client(){
 let cookie='';
 return async(path,method='GET',body,expected=200)=>{
 const response=await fetch(base+'/api/'+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
 const data=await response.json();
 assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(data));return data;
 };
}
const anonymous=client(),faculty=client(),other=client(),hod=client(),auditor=client(),admin=client();
await anonymous('dashboard','GET',undefined,401);
await faculty('auth/login','POST',{email:'ravi.kumar@pes.edu',password});
await other('auth/login','POST',{email:'meena.iyer@pes.edu',password});
await hod('auth/login','POST',{email:'hod.cse@pes.edu',password});
await auditor('auth/login','POST',{email:'auditor@pes.edu',password});
await admin('auth/login','POST',{email:'principal@pes.edu',password});
const report=await auditor('reports?cycle_id=1');
assert.deepEqual(Object.fromEntries(report.approved.map(r=>[r.dept_code,Number(r.approved_submissions)])),{ECE:2,CSE:1,ME:0});
assert.deepEqual(Object.fromEntries(report.pending.map(r=>[r.dept_code,Number(r.pending_total)])),{CSE:3,ECE:1,ME:0});
const facultyReport=await faculty('reports?cycle_id=1');
assert(facultyReport.approved.every(r=>r.dept_code==='CSE'));
await anonymous('reports?cycle_id=1','GET',undefined,401);
await auditor('reports?cycle_id=9999','GET',undefined,404);
console.log('PASS: three report endpoints, zero counts, department scope and unauthenticated rejection.');
// Statistics are compared to the actual scoped register, not just UI fixtures.
async function checkStatistics(client,role){
 const dash=await client('dashboard'),r=await client('statistics?cycle_id=1');
 const records=[...dash.faculty,...dash.department].filter(x=>Number(x.cycle_id)===1);
 assert.equal(r.summary.total,records.length,role+' total must match scoped records');
 for(const status of ['Draft','Submitted','Verified','Approved','Rejected'])assert.equal(r.summary.counts[status],records.filter(x=>x.status===status).length,role+' '+status);
 assert.equal(r.summary.pending,records.filter(x=>['Submitted','Verified'].includes(x.status)).length);
 assert.equal(r.backlog.reduce((sum,d)=>sum+d.total,0),r.summary.pending);
 const monthly={};for(const row of dash.faculty.filter(x=>Number(x.cycle_id)===1)){const m=row.created_at.slice(0,7);monthly[m]=(monthly[m]??0)+1;}
 assert.deepEqual(Object.fromEntries(r.monthly.map(x=>[x.month,x.count])),monthly);
 if(role==='Faculty'){assert.equal(r.scores,null);assert.equal(r.filters.kind,'faculty');assert.equal(dash.department.length,0);assert.equal(dash.scores.length,0);assert.equal(r.departments.length,1);}
 return r;
}
await anonymous('statistics?cycle_id=1','GET',undefined,401);
const institutional=await checkStatistics(auditor,'Auditor');
assert.equal(institutional.summary.total,9);
assert.deepEqual(institutional.summary.counts,{Draft:0,Submitted:2,Verified:2,Approved:4,Rejected:1});
assert.equal(institutional.summary.approvalPercentage,44.4);
await checkStatistics(admin,'Admin');await checkStatistics(hod,'HOD');
const ownStats=await checkStatistics(faculty,'Faculty');assert.equal(ownStats.summary.total,2);
assert.deepEqual((await faculty('reports?cycle_id=1')).scores,[]);
assert.equal(Number((await faculty('reports?cycle_id=1')).pending[0].pending_total),1);
await faculty('statistics?cycle_id=1&dept_id=2','GET',undefined,403);
await hod('statistics?cycle_id=1&dept_id=2','GET',undefined,403);
await faculty('statistics?cycle_id=1&kind=department','GET',undefined,403);
await auditor('statistics?cycle_id=999999','GET',undefined,404);
await auditor('statistics?cycle_id=1&dept_id=999999','GET',undefined,404);
await auditor('statistics?cycle_id=1&kind=unknown','GET',undefined,400);
await auditor('statistics?cycle_id=1%20OR%201=1','GET',undefined,400);
const emptyStats=await auditor('statistics?cycle_id=2');
assert.equal(emptyStats.summary.total,0);assert.equal(emptyStats.summary.approvalPercentage,null);assert.deepEqual(emptyStats.monthly,[]);
assert(emptyStats.scores.every(x=>x.total_weighted_score===null));
const zeroStats=await auditor('statistics?cycle_id=1&dept_id=3');
assert.equal(zeroStats.summary.total,0);assert.equal(zeroStats.backlog.length,1);
const deptStats=await auditor('statistics?cycle_id=1&dept_id=1');
assert.equal(deptStats.summary.total,6);assert.equal(deptStats.backlog.length,1);assert.equal(deptStats.departments.length,3);
const onlyDept=await auditor('statistics?cycle_id=1&kind=department');
assert.equal(onlyDept.summary.total,3);assert.equal(onlyDept.monthly,null);
const onlyFaculty=await auditor('statistics?cycle_id=1&kind=faculty');assert.equal(onlyFaculty.summary.total,6);
console.log('PASS: statistics totals/monthly activity match scoped registers for all four roles; filters, zero/empty cycles, scores and denied requests verified.');

await faculty('scores/recalculate','POST',{cycle_id:1},403);
await auditor('scores/recalculate','POST',{cycle_id:1});
let scorecard=(await auditor('dashboard')).scores;
assert.equal(Number(scorecard.find(s=>s.dept_code==='CSE'&&s.cycle_id===1).total_weighted_score),31.25,'Start from a fresh seeded demo database');
assert.equal(Number(scorecard.find(s=>s.dept_code==='ECE'&&s.cycle_id===1).total_weighted_score),19.50);
await admin('scores/recalculate','POST',{cycle_id:2},409);
const draft={metric_id:6,cycle_id:1,title:marker,doi_or_isbn:marker,evidence_url:'https://example.edu/evidence.pdf',evidence:{submission_type:'book_chapter',authors:[{name:'Ravi Kumar'}],details:{book_title:'Database systems',publisher:'University Press'},attachments:[]}};
const created=await faculty('faculty','POST',draft,201);assert.equal(created.evidenceSync.pending,0,'MongoDB must be online');
const id=created.id;
await other('faculty/'+id+'/evidence','GET',undefined,403);
const original=await faculty('faculty/'+id+'/evidence');assert.equal(original.document.details.publisher,'University Press');
await faculty('faculty/'+id,'PATCH',{...draft,title:marker+' updated',evidence:{...draft.evidence,details:{...draft.evidence.details,publisher:'Revised publisher'}}});
assert.equal((await faculty('faculty/'+id+'/evidence')).document.details.publisher,'Revised publisher');
await faculty('faculty/'+id+'/evidence','DELETE');
assert.equal((await faculty('faculty/'+id+'/evidence')).document,null);
await faculty('faculty/'+id+'/status','PATCH',{status:'Submitted'},409);
await faculty('faculty/'+id,'PATCH',draft);
await faculty('faculty/'+id+'/status','PATCH',{status:'Submitted'});
await faculty('faculty/'+id,'PATCH',draft,403);
await faculty('faculty/'+id+'/status','PATCH',{status:'Approved',score:5},403);
await hod('faculty/'+id+'/status','PATCH',{status:'Verified',remarks:'Integration verification'});
await admin('faculty/'+id+'/status','PATCH',{status:'Approved',score:5},403);
await auditor('faculty/'+id+'/status','PATCH',{status:'Approved',score:8,remarks:'Integration approval'});
scorecard=(await auditor('dashboard')).scores;
assert.equal(Number(scorecard.find(s=>s.dept_code==='CSE'&&s.cycle_id===1).total_weighted_score),39.25,'Faculty approval automatically refreshes scores');
const history=await faculty('faculty/'+id+'/logs');assert.deepEqual(history.logs.map(l=>l.new_status),['Submitted','Verified','Approved']);
await faculty('faculty/'+id+'/evidence','DELETE',undefined,403);
const view=await faculty('dashboard');assert(view.faculty.every(r=>Number(r.faculty_id)===5));
const hodView=await hod('dashboard');assert(hodView.faculty.every(r=>Number(r.dept_id)===1));
const otherHod=client();await otherHod('auth/login','POST',{email:'hod.ece@pes.edu',password});
await otherHod('faculty/'+id+'/logs','GET',undefined,403);
// A separate unreviewed Draft exercises safe withdrawal without deleting logs.
const tmp=await faculty('faculty','POST',{...draft,title:marker+' withdrawal',doi_or_isbn:marker+' withdrawal'},201);
await faculty('faculty/'+tmp.id,'DELETE');
await faculty('faculty/'+tmp.id+'/evidence','GET',undefined,404);
// Department evidence CRUD and HOD -> Auditor workflow.
const departmentDraft={metric_id:20,cycle_id:1,metric_value:90,evidence_url:'https://example.edu/budget.pdf',evidence:{metric_category:'budget',summary:marker,details:{allocated_inr:100000,spent_inr:90000},attachments:[]}};
await other('department','POST',departmentDraft,403);
const department=await hod('department','POST',departmentDraft,201);
const did=department.id;assert.equal(department.evidenceSync.pending,0);
assert.equal((await hod('department/'+did+'/evidence')).document.details.spent_inr,90000);
await hod('department/'+did,'PATCH',{...departmentDraft,metric_value:95,evidence:{...departmentDraft.evidence,details:{allocated_inr:100000,spent_inr:95000}}});
assert.equal((await hod('department/'+did+'/evidence')).document.details.spent_inr,95000);
await hod('department/'+did+'/evidence','DELETE');
assert.equal((await hod('department/'+did+'/evidence')).document,null);
await hod('department/'+did,'PATCH',departmentDraft);
await hod('department/'+did+'/status','PATCH',{status:'Submitted'});
await hod('department/'+did+'/status','PATCH',{status:'Verified'},403);
await auditor('department/'+did+'/status','PATCH',{status:'Verified',remarks:marker});
await auditor('department/'+did+'/status','PATCH',{status:'Approved',remarks:marker});
scorecard=(await auditor('dashboard')).scores;
assert.equal(Number(scorecard.find(s=>s.dept_code==='CSE'&&s.cycle_id===1).total_weighted_score),48.25,'Department approval automatically refreshes scores');
assert((await hod('dashboard')).scores.every(s=>s.dept_id===1));
assert((await otherHod('dashboard')).scores.every(s=>s.dept_id===2));
const departmentHistory=await hod('department/'+did+'/logs');
assert.deepEqual(departmentHistory.logs.map(l=>l.new_status),['Submitted','Verified','Approved']);
await faculty('department/'+did+'/evidence','GET',undefined,403);
await otherHod('department/'+did+'/evidence','GET',undefined,403);
await checkStatistics(auditor,'Auditor');await checkStatistics(hod,'HOD');await checkStatistics(faculty,'Faculty');
await faculty('auth/logout','POST',{});
await faculty('dashboard','GET',undefined,401);
console.log('PASS: authenticated SQL/Mongo CRUD, role restrictions, workflow, logging, withdrawal and logout.');
console.log('Retained Approved records for inspection: faculty '+id+', department '+did);

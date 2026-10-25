import {reportQueries} from './reports.js';
import {ObjectId} from 'mongodb';
import {pool,transaction,mongo} from './db.js';
import {enqueue,flushOutbox,latestEvidence} from './outbox.js';
import {assert,integer,text,url,kindConfig,canRead,canEdit,transitions,evidence} from './policy.js';
export async function getRecord(c,kind,id,lock=false){
 const k=kindConfig(kind);
 const join=kind==='faculty'?'JOIN User_Auth_Roles u ON u.user_id=r.faculty_id':'';
 const [rows]=await c.execute('SELECT r.*,c.status AS cycle_status,'+(kind==='faculty'?'u.dept_id,':'')+'m.max_score,m.criteria_number FROM '+k.table+' r '+join+' JOIN Audit_Cycles c ON c.cycle_id=r.cycle_id JOIN Criteria_Metrics_Master m ON m.metric_id=r.metric_id WHERE r.'+k.id+'=?'+(lock?' FOR UPDATE OF r':''),[id]);
 assert(rows.length,'Record not found',404);return rows[0];
}
async function actorStillActive(c,user){
 const [rows]=await c.execute('SELECT role,dept_id FROM User_Auth_Roles WHERE user_id=? AND is_active=TRUE FOR UPDATE',[user.user_id]);
 assert(rows.length&&rows[0].role===user.role&&rows[0].dept_id===user.dept_id,'Account changed; please sign in again',401);
}
async function mutate(user,fn){const result=await transaction(user,async c=>{await actorStillActive(c,user);return fn(c);});let sync;try{sync=await flushOutbox(30)}catch{sync={pending:true}}return {...result,evidenceSync:sync};}
export async function dashboard(user){
 let where='',args=[];
 if(user.role==='Faculty'){where=' WHERE r.faculty_id=?';args=[user.user_id];}
 if(user.role==='HOD'){where=' WHERE u.dept_id=?';args=[user.dept_id];}
 const [faculty]=await pool.execute('SELECT r.*,u.dept_id,CONCAT(u.first_name," ",u.last_name) AS owner_name,d.dept_code,m.criteria_number,m.description,m.max_score,c.cycle_name,c.status AS cycle_status FROM Faculty_Submissions r JOIN User_Auth_Roles u ON u.user_id=r.faculty_id JOIN Departments d ON d.dept_id=u.dept_id JOIN Criteria_Metrics_Master m ON m.metric_id=r.metric_id JOIN Audit_Cycles c ON c.cycle_id=r.cycle_id'+where+' ORDER BY r.updated_at DESC',args);
 let department=[];
 if(user.role!=='Faculty'){
 const w=user.role==='HOD'?' WHERE r.dept_id=?':'';
 [department]=await pool.execute('SELECT r.*,CONCAT(u.first_name," ",u.last_name) AS owner_name,d.dept_code,m.criteria_number,m.description,m.max_score,c.cycle_name,c.status AS cycle_status FROM Department_Metrics r JOIN User_Auth_Roles u ON u.user_id=r.hod_id JOIN Departments d ON d.dept_id=r.dept_id JOIN Criteria_Metrics_Master m ON m.metric_id=r.metric_id JOIN Audit_Cycles c ON c.cycle_id=r.cycle_id'+w+' ORDER BY r.updated_at DESC',user.role==='HOD'?[user.dept_id]:[]);
 }
 const [cycles]=await pool.query('SELECT cycle_id,cycle_name,start_date,end_date,status FROM Audit_Cycles ORDER BY cycle_id DESC');
 const [metrics]=await pool.query('SELECT m.* FROM Criteria_Metrics_Master m WHERE NOT EXISTS(SELECT 1 FROM Criteria_Metrics_Master child WHERE child.parent_metric_id=m.metric_id) ORDER BY criteria_number');
 const scope=['Faculty','HOD'].includes(user.role)?' WHERE a.dept_id=?':'';
 const [scores]=await pool.execute('SELECT a.*,d.dept_code,d.dept_name,c.cycle_name,c.status AS cycle_status FROM Score_Aggregates a JOIN Departments d ON d.dept_id=a.dept_id JOIN Audit_Cycles c ON c.cycle_id=a.cycle_id'+scope+' ORDER BY a.cycle_id DESC,a.total_weighted_score DESC',scope?[user.dept_id]:[]);
 return {faculty,department,cycles,metrics,scores};
}
function evidenceDocument(content,kind,row,oid){
 const now=new Date().toISOString(),ev=evidence(content,kind);
 if(kind==='faculty'){
 const expected={ '3.2.1':['patent'],'3.3.1':['research_paper'],'3.3.2':['book_chapter'],'2.4.1':['workshop','fdp'],'2.3.4':['mentorship']}[row.criteria_number];
 if(expected)assert(expected.includes(ev.submission_type),'Evidence type does not match the selected criterion');
 return {...ev,_id:oid,mysql_submission_id:Number(row.submission_id),faculty_id:Number(row.faculty_id),cycle_id:Number(row.cycle_id),title:row.title,created_at:now,updated_at:now};
 }
 const expected={'4.1.3':'lab_upgrade','5.2.1':'placement','6.4.1':'budget'}[row.criteria_number];
 if(expected)assert(expected===ev.metric_category,'Evidence category does not match the selected criterion');
 return {...ev,_id:oid,mysql_dept_metric_id:Number(row.dept_metric_id),dept_id:Number(row.dept_id),cycle_id:Number(row.cycle_id),created_at:now,updated_at:now};
}
export async function createRecord(user,kind,input){
 const k=kindConfig(kind);assert(user.role===k.role,'Your role cannot create this record',403);
 const metric=integer(input.metric_id,'Metric'),cycle=integer(input.cycle_id,'Cycle'),link=url(input.evidence_url);
 return mutate(user,async c=>{
 const oid=new ObjectId().toHexString();let id;
 if(kind==='faculty'){
 const [r]=await c.execute('INSERT INTO Faculty_Submissions(faculty_id,metric_id,cycle_id,title,doi_or_isbn,evidence_url,mongo_doc_id) VALUES(?,?,?,?,?,?,?)',[user.user_id,metric,cycle,text(input.title,'Title',255),input.doi_or_isbn?text(input.doi_or_isbn,'DOI / ISBN',100):null,link,oid]);id=r.insertId;
 }else{
 assert(typeof input.metric_value==='number'&&Number.isFinite(input.metric_value)&&input.metric_value>=0&&input.metric_value<=100,'Enter a percentage from 0 to 100');
 const [r]=await c.execute('INSERT INTO Department_Metrics(dept_id,hod_id,metric_id,cycle_id,metric_value,evidence_url,mongo_doc_id) VALUES(?,?,?,?,?,?,?)',[user.dept_id,user.user_id,metric,cycle,input.metric_value,link,oid]);id=r.insertId;
 }
 const row=await getRecord(c,kind,id),document=evidenceDocument(input.evidence,kind,row,oid);
 await enqueue(c,k.collection,oid,'replace',document);return {id,message:'Draft created'};
 });
}
export async function changeStatus(user,kind,id,input){
 const k=kindConfig(kind);return mutate(user,async c=>{
 const row=await getRecord(c,kind,id,true);assert(transitions(user,row,kind).includes(input.status),'This status change is not allowed for your role',403);
 if(['Submitted','Verified','Approved'].includes(input.status)){
 assert(row.mongo_doc_id,'Attach evidence before submitting or reviewing',409);
 const [[pending]]=await c.execute('SELECT COUNT(*) AS n FROM Evidence_Outbox WHERE mongo_id=? AND processed_at IS NULL',[row.mongo_doc_id]);
 assert(Number(pending.n)===0,'Evidence synchronization is pending. Sync before submitting or reviewing',409);
 const document=await mongo().collection(k.collection).findOne({_id:new ObjectId(row.mongo_doc_id)});
 assert(document,'The evidence document is missing',409);
 }
 const remarks=typeof input.remarks==='string'?input.remarks.trim().slice(0,2000):'';
 assert(input.status!=='Rejected'||remarks,'Please explain why the record is rejected');
 await c.query('SET @status_remarks = ?',[remarks||null]);
 if(kind==='faculty'&&input.status==='Approved'){
 assert(typeof input.score==='number'&&Number.isFinite(input.score)&&input.score>=0&&input.score<=Number(row.max_score),'Score must be between 0 and '+row.max_score);
 await c.execute('UPDATE Faculty_Submissions SET status=?,score_awarded=? WHERE submission_id=?',[input.status,input.score,id]);
 }else await c.execute('UPDATE '+k.table+' SET status=? WHERE '+k.id+'=?',[input.status,id]);
 if(input.status==='Approved')await c.execute('CALL sp_recalculate_scores(?)',[row.cycle_id]);
 return {message:input.status==='Approved'?'Status updated and department scores refreshed':'Status updated'};
 });
}
export async function readEvidence(user,kind,id){
 const c=await pool.getConnection();
 try{
 const row=await getRecord(c,kind,id);assert(canRead(user,row,kind),'Access denied',403);
 if(!row.mongo_doc_id)return {document:null,pending:false};
 // Read the real Mongo document for the NoSQL R demo.
 const document=await mongo().collection(kindConfig(kind).collection).findOne({_id:new ObjectId(row.mongo_doc_id)});
 const [jobs]=await c.execute('SELECT COUNT(*) AS n FROM Evidence_Outbox WHERE mongo_id=? AND processed_at IS NULL',[row.mongo_doc_id]);
 return {document,pending:Number(jobs[0].n)>0};
 }finally{c.release();}
}
export async function updateRecord(user,kind,id,input){
 const k=kindConfig(kind);return mutate(user,async c=>{
 const row=await getRecord(c,kind,id,true);assert(canEdit(user,row,kind),'Only the owner may edit a Draft or Rejected record in an active cycle',403);
 const title=kind==='faculty'?text(input.title,'Title',255):null;
 const oid=row.mongo_doc_id??new ObjectId().toHexString();
 const previous=row.mongo_doc_id?await latestEvidence(c,k.collection,oid):null;
 const document=evidenceDocument(input.evidence,kind,{...row,title:title??row.title},oid);
 if(previous?.created_at)document.created_at=previous.created_at;
 if(kind==='faculty')await c.execute('UPDATE Faculty_Submissions SET title=?,doi_or_isbn=?,evidence_url=?,mongo_doc_id=? WHERE submission_id=?',[title,input.doi_or_isbn?text(input.doi_or_isbn,'DOI / ISBN',100):null,url(input.evidence_url),oid,id]);
 else{
 assert(typeof input.metric_value==='number'&&Number.isFinite(input.metric_value)&&input.metric_value>=0&&input.metric_value<=100,'Percentage must be between 0 and 100');
 await c.execute('UPDATE Department_Metrics SET metric_value=?,evidence_url=?,mongo_doc_id=? WHERE dept_metric_id=?',[input.metric_value,url(input.evidence_url),oid,id]);
 }
 await enqueue(c,k.collection,oid,'replace',document);return {message:'Record and evidence updated'};
 });
}
export async function deleteEvidence(user,kind,id,deleteRecord=false){
 const k=kindConfig(kind);return mutate(user,async c=>{
 const row=await getRecord(c,kind,id,true);assert(canEdit(user,row,kind),'Only editable owner records may be deleted',403);
 if(deleteRecord){assert(row.status==='Draft','Only Draft records may be withdrawn');await c.execute('DELETE FROM '+k.table+' WHERE '+k.id+'=?',[id]);}
 else await c.execute('UPDATE '+k.table+' SET mongo_doc_id=NULL WHERE '+k.id+'=?',[id]);
 if(row.mongo_doc_id)await enqueue(c,k.collection,row.mongo_doc_id,'delete');
 return {message:deleteRecord?'Draft withdrawn':'Mongo evidence removed; SQL record retained'};
 });
}
export async function logs(user,kind,id){
 const c=await pool.getConnection();try{const row=await getRecord(c,kind,id);assert(canRead(user,row,kind),'Access denied',403);
 const [rows]=await c.execute('SELECT l.*,CONCAT(u.first_name," ",u.last_name) AS actor_name,u.role AS actor_role FROM Verification_Logs l JOIN User_Auth_Roles u ON u.user_id=l.action_by_user_id WHERE l.'+(kind==='faculty'?'submission_id':'dept_metric_id')+'=? ORDER BY l.log_id',[id]);return rows;}finally{c.release();}
}
export async function changeCycle(user,id,input){
 assert(['Admin','Auditor'].includes(user.role),'Access denied',403);
 assert(['Active','Locked','Archived'].includes(input.status),'Invalid cycle status');
 return mutate(user,async c=>{
 if(input.status==='Locked')await c.execute('CALL sp_recalculate_scores(?)',[id]);
 await c.execute('UPDATE Audit_Cycles SET status=? WHERE cycle_id=?',[input.status,id]);
 return {message:input.status==='Locked'?'Cycle locked and scores refreshed':'Cycle updated'};
 });
}
export async function createCycle(user,input){
 assert(['Admin','Auditor'].includes(user.role),'Access denied',403);
 const name=text(input.cycle_name,'Cycle name',100);
 assert(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.start_date)&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.end_date)&&input.end_date>input.start_date,'Provide valid start/end dates');
 return mutate(user,async c=>{const [r]=await c.execute('INSERT INTO Audit_Cycles(cycle_name,start_date,end_date,created_by) VALUES(?,?,?,?)',[name,input.start_date,input.end_date,user.user_id]);return {id:r.insertId,message:'Draft cycle created'};});
}
export async function syncEvidence(user){assert(['Admin','Auditor'].includes(user.role),'Access denied',403);return flushOutbox();}

export async function recalculateScores(user,input){
 assert(['Admin','Auditor'].includes(user.role),'Only an Auditor or Admin can refresh scores',403);
 const cycle=integer(input.cycle_id,'Cycle');
 return mutate(user,async c=>{
 await c.execute('CALL sp_recalculate_scores(?)',[cycle]);
 return {message:'Department scores refreshed'};
 });
}

export async function reports(user,cycleId){
 const queries=reportQueries(user,cycleId),c=await pool.getConnection();
 try{
 await c.beginTransaction();
 const [cycles]=await c.execute('SELECT cycle_id,cycle_name,status FROM Audit_Cycles WHERE cycle_id=?',[Number(cycleId)]);
 assert(cycles.length,'Audit cycle not found',404);
 const result={cycle:cycles[0]};
 for(const [name,query] of Object.entries(queries)){
 const [rows]=await c.execute(query.sql,query.params);result[name]=rows;
 }
 await c.commit();return result;
 }catch(e){await c.rollback();throw e}finally{c.release();}
}

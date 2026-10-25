import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {sqlStatements} from '../lib/sql-script.js';
import {reportQueries} from '../lib/reports.js';
import {getRecord} from '../lib/service.js';
import {pool} from '../lib/db.js';

// Creates and removes a dedicated QA schema. It refuses to overwrite any
// existing schema or QA account and never resets the configured project DB.
const p=process.env,db=p.MYSQL_QA_DATABASE??'iqac_qa_demo',qaUser='iqac_qa_app';
assert.match(db,/^iqac_qa_[a-z0-9_]+$/);
assert.notEqual(db,p.MYSQL_DATABASE??'iqac_db');
const c=await mysql.createConnection({host:p.MYSQL_HOST??'127.0.0.1',port:Number(p.MYSQL_PORT??3306),user:p.MYSQL_SETUP_USER??'root',password:p.MYSQL_SETUP_PASSWORD??'',decimalNumbers:true,multipleStatements:false});
let createdSchema=false,createdUser=false;
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS: '+name)};
const query=async(sql,args=[])=>{const [rows]=await c.query(sql,args);return rows};
try{
 const [existing]=await c.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[db]);
 assert.equal(existing.length,0,'Refusing to overwrite an existing QA schema');
 const [accounts]=await c.execute("SELECT User FROM mysql.user WHERE User=? AND Host='localhost'",[qaUser]);
 assert.equal(accounts.length,0,'Refusing to overwrite an existing QA account');
 await check('Import schema, seed, DML, corrected triggers, portal extension and scoring procedure',async()=>{
  for(const name of ['01_schema.sql','04_seed_data.sql','05_dml_queries.sql','06_triggers.sql','07_portal.sql','09_score_calculation.sql']){
   const source=(await fs.readFile(new URL('../'+name,import.meta.url),'utf8')).replaceAll(/\biqac_db\b/g,db);
   for(const statement of sqlStatements(source)){
    if(/^DROP DATABASE/i.test(statement))continue;
    await c.query(statement);
    if(/^CREATE DATABASE/i.test(statement))createdSchema=true;
   }
  }
 });
 const score=async()=>query('SELECT d.dept_code,a.total_weighted_score FROM Score_Aggregates a JOIN Departments d USING(dept_id) WHERE a.cycle_id=1 ORDER BY d.dept_id');
 await c.query('SET @current_user_id=2');
 await check('Scoring procedure produces CSE 31.25, ECE 19.50 and ME zero',async()=>{
  await c.beginTransaction();await c.query('CALL sp_recalculate_scores(1)');await c.commit();
  assert.deepEqual((await score()).map(r=>[r.dept_code,r.total_weighted_score]),[['CSE',31.25],['ECE',19.5],['ME',0]]);
 });
 await check('Report joins preserve departments with zero approved work',async()=>{
  const q=reportQueries({role:'Auditor'},1).approved;
  const rows=await query(q.sql,q.params);
  assert.deepEqual(Object.fromEntries(rows.map(r=>[r.dept_code,Number(r.approved_submissions)])),{ECE:2,CSE:1,ME:0});
 });
 await check('Pending report counts records without multiplying joins',async()=>{
  const q=reportQueries({role:'Auditor'},1).pending;
  const rows=await query(q.sql,q.params);
  assert.deepEqual(Object.fromEntries(rows.map(r=>[r.dept_code,[Number(r.waiting_for_hod),Number(r.waiting_for_auditor),Number(r.pending_total)]])),{CSE:[1,2,3],ECE:[0,1,1],ME:[0,0,0]});
 });
 await check('Reports enforce department scope at SQL level',async()=>{
  for(const q of Object.values(reportQueries({role:'HOD',dept_id:2},1))){
   const rows=await query(q.sql,q.params);
   assert.equal(rows.length,1);assert.equal(rows[0].dept_code,'ECE');
  }
 });
 await check('Repeated score refresh preserves aggregate identities',async()=>{
  const before=await query('SELECT aggregate_id FROM Score_Aggregates WHERE cycle_id=1 ORDER BY dept_id');
  await c.query('CALL sp_recalculate_scores(1)');
  assert.deepEqual(await query('SELECT aggregate_id FROM Score_Aggregates WHERE cycle_id=1 ORDER BY dept_id'),before);
 });
 await check('Faculty, missing actors and archived cycles cannot recalculate scores',async()=>{
  for(const actor of [5,null]){await c.query('SET @current_user_id=?',[actor]);await assert.rejects(c.query('CALL sp_recalculate_scores(1)'),/Only an active Auditor or Admin/);}
  await c.query('SET @current_user_id=2');await assert.rejects(c.query('CALL sp_recalculate_scores(2)'),/Active or Locked/);
 });
 await check('Invalid weights fail and caller rollback restores state',async()=>{
  await c.beginTransaction();
  await c.query('UPDATE Criteria_Metrics_Master SET weightage=.11 WHERE metric_id=14');
  await assert.rejects(c.query('CALL sp_recalculate_scores(1)'),/weights must sum/);
  await c.rollback();
  const [[row]]=await c.query('SELECT weightage FROM Criteria_Metrics_Master WHERE metric_id=14');
  assert.equal(row.weightage,.10);
 });
 await check('Faculty approval workflow and metric cap work on real MySQL',async()=>{
  for(const [owner,title,doi,points] of [[5,'QA score paper one','QA-score-1',18],[6,'QA score paper two','QA-score-2',18]]){
   await c.query('SET @current_user_id=?',[owner]);
   const [r]=await c.execute('INSERT INTO Faculty_Submissions(faculty_id,metric_id,cycle_id,title,doi_or_isbn,evidence_url) VALUES(?,5,1,?,?,?)',[owner,title,doi,'https://example.edu/test.pdf']);
   await c.execute("UPDATE Faculty_Submissions SET status='Submitted' WHERE submission_id=?",[r.insertId]);
   await c.query('SET @current_user_id=3');await c.execute("UPDATE Faculty_Submissions SET status='Verified' WHERE submission_id=?",[r.insertId]);
   await c.query('SET @current_user_id=2');await c.execute("UPDATE Faculty_Submissions SET status='Approved',score_awarded=? WHERE submission_id=?",[points,r.insertId]);
  }
  await c.query('CALL sp_recalculate_scores(1)');
  assert.equal((await score())[0].total_weighted_score,33.25);
 });
 await check('Direct self-parent insert is rejected without leaving a row',async()=>{
  await assert.rejects(c.query("INSERT INTO Criteria_Metrics_Master(metric_id,parent_metric_id,criteria_number,description,metric_type,max_score,weightage,target_role) VALUES(900,900,'QA.900','Self-parent probe','Quantitative',1,0,'Faculty')"),/cannot be its own parent/);
  const [[r]]=await c.query('SELECT COUNT(*) AS n FROM Criteria_Metrics_Master WHERE metric_id=900');assert.equal(Number(r.n),0);
 });
 await check('Restricted app grants allow procedure execution but prevent forged logs',async()=>{
  const {randomBytes}=await import('node:crypto');const password=randomBytes(20).toString('hex');
  // Dedicated disposable QA account; never alters the real iqac_app account.
  const source=(await fs.readFile(new URL('../08_app_grants.sql',import.meta.url),'utf8'))
   .replaceAll(/\biqac_db\b/g,db).replaceAll("'iqac_app'","'iqac_qa_app'").replace('REPLACE_WITH_A_LONG_RANDOM_PASSWORD',password);
  for(const statement of sqlStatements(source)){
   await c.query(statement);if(/^CREATE USER/i.test(statement))createdUser=true;
  }
  const app=await mysql.createConnection({host:p.MYSQL_HOST??'127.0.0.1',port:Number(p.MYSQL_PORT??3306),user:qaUser,password,database:db});
  try{await app.beginTransaction();await getRecord(app,'faculty',2,true);await getRecord(app,'department',2,true);await app.rollback();await app.query('SET @current_user_id=2');await app.query('CALL sp_recalculate_scores(1)');await assert.rejects(app.query("INSERT INTO Verification_Logs(submission_id,action_by_user_id,new_status) VALUES(1,2,'Approved')"),/INSERT command denied/);}
  finally{await app.end();}
 });
 console.log(checks+' live SQL check groups passed. Only the disposable QA schema was changed.');
}finally{
 if(createdUser)await c.query("DROP USER 'iqac_qa_app'@'localhost'");
 if(createdSchema)await c.query('DROP DATABASE '+mysql.escapeId(db));
 await c.end();await pool.end();
}

import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import {randomBytes} from 'node:crypto';
import {sqlStatements} from '../lib/sql-script.js';

async function main(){
 const p=process.env,db=p.MYSQL_DATABASE??'iqac_db',user=p.MYSQL_USER??'iqac_app';
 if(!/^[A-Za-z0-9_]+$/.test(db)||!/^[A-Za-z0-9_]+$/.test(user)||user==='root')throw Error('Use a simple project database name and a non-root app user');
 const c=await mysql.createConnection({host:p.MYSQL_HOST??'127.0.0.1',port:Number(p.MYSQL_PORT??3306),user:p.MYSQL_SETUP_USER??'root',password:p.MYSQL_SETUP_PASSWORD??'',connectTimeout:5000});
 try{
  const run=async name=>{
   let source=await fs.readFile(new URL('../'+name,import.meta.url),'utf8');
   source=source.replaceAll(/\biqac_db\b/g,db);
   for(let statement of sqlStatements(source)){
    if(/^DROP DATABASE/i.test(statement))continue;
    if(/^CREATE DATABASE /i.test(statement))statement=statement.replace(/^CREATE DATABASE /i,'CREATE DATABASE IF NOT EXISTS ');
    await c.query(statement);
   }
  };
  const [tables]=await c.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[db]);
  const core=['departments','user_auth_roles','audit_cycles','criteria_metrics_master','faculty_submissions','department_metrics','verification_logs','score_aggregates'];
  const names=tables.map(t=>t.TABLE_NAME.toLowerCase());
  if(!names.length){await run('01_schema.sql');console.log('Created the project schema; no existing database was dropped.');}
  else if(!core.every(t=>names.includes(t)))throw Error('Partial project schema detected; repair it before bootstrapping');
  await c.query('USE '+mysql.escapeId(db));
  let total=0;for(const table of core){const [[r]]=await c.query('SELECT COUNT(*) AS n FROM '+mysql.escapeId(table));total+=Number(r.n);}
  if(total===0){await run('04_seed_data.sql');console.log('Loaded the supplied demo seed into empty tables.');}
  else console.log('Existing project records preserved.');
  for(const name of ['06_triggers.sql','07_portal.sql','09_score_calculation.sql'])await run(name);
  const [accounts]=await c.execute("SELECT User FROM mysql.user WHERE User=? AND Host='localhost'",[user]);
  let password=p.MYSQL_PASSWORD;
  if(accounts.length&&!password)throw Error('The app user already exists; fill MYSQL_PASSWORD before retrying');
  password ||= 'IQac9!'+randomBytes(24).toString('base64url');
  let env=await fs.readFile(new URL('../.env.local',import.meta.url),'utf8');
  const set=(key,value)=>{const pattern=new RegExp('^'+key+'=.*$','m');env=pattern.test(env)?env.replace(pattern,()=>key+'='+value):env+'\n'+key+'='+value+'\n';};
  set('MYSQL_USER',user);set('MYSQL_PASSWORD',password);
  await fs.writeFile(new URL('../.env.local',import.meta.url),env);
  let grants=await fs.readFile(new URL('../08_app_grants.sql',import.meta.url),'utf8');
  grants=grants.replaceAll(/\biqac_db\b/g,db).replaceAll("'iqac_app'",mysql.escape(user)).replace("'REPLACE_WITH_A_LONG_RANDOM_PASSWORD'",mysql.escape(password));
  for(const statement of sqlStatements(grants))await c.query(statement);
  console.log('Configured the restricted app account; password saved only in .env.local.');
  const [actors]=await c.query("SELECT user_id FROM User_Auth_Roles WHERE is_active=TRUE AND role IN ('Auditor','Admin') ORDER BY user_id LIMIT 1");
  if(actors.length){
   await c.query('SET @current_user_id=?',[actors[0].user_id]);
   const [cycles]=await c.query("SELECT cycle_id FROM Audit_Cycles WHERE status IN ('Active','Locked')");
   for(const cycle of cycles){await c.beginTransaction();try{await c.execute('CALL sp_recalculate_scores(?)',[cycle.cycle_id]);await c.commit();}catch(e){await c.rollback();throw e;}}
   await c.query('SET @current_user_id=NULL');
  }
  console.log('MySQL workflow, scoring and app setup completed.');
 }finally{await c.end();}
}
main().catch(e=>{console.error('Setup failed: '+(e.code??e.message));process.exitCode=1});

import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {sqlStatements} from '../lib/sql-script.js';
import {localMongo,runNode,projectRoot} from './local-mongo.mjs';
const p=process.env,suffix=Date.now().toString(),db='iqac_qa_web_'+suffix,account='iqac_qa_'+suffix,password=randomBytes(24).toString('hex');
let root,mongo,web,createdSchema=false,createdUser=false;
try{
 mongo=await localMongo();
 // Initialize the real Mongo evidence if absent; existing collections are preserved.
 await runNode('scripts/setup.mjs');
 root=await mysql.createConnection({host:p.MYSQL_HOST??'127.0.0.1',port:Number(p.MYSQL_PORT??3306),user:p.MYSQL_SETUP_USER??'root',password:p.MYSQL_SETUP_PASSWORD??''});
 const [old]=await root.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[db]);assert.equal(old.length,0);
 for(const name of ['01_schema.sql','04_seed_data.sql','06_triggers.sql','07_portal.sql','09_score_calculation.sql']){
  const source=(await fs.readFile(new URL('../'+name,import.meta.url),'utf8')).replaceAll(/\biqac_db\b/g,db);
  for(const statement of sqlStatements(source)){
   if(/^DROP DATABASE/i.test(statement))continue;
   await root.query(statement);if(/^CREATE DATABASE/i.test(statement))createdSchema=true;
  }
 }
 const grants=(await fs.readFile(new URL('../08_app_grants.sql',import.meta.url),'utf8')).replaceAll(/\biqac_db\b/g,db).replaceAll("'iqac_app'",mysql.escape(account)).replace("'REPLACE_WITH_A_LONG_RANDOM_PASSWORD'",mysql.escape(password));
 for(const statement of sqlStatements(grants)){await root.query(statement);if(/^CREATE USER/i.test(statement))createdUser=true;}
 const env={...p,MYSQL_DATABASE:db,MYSQL_USER:account,MYSQL_PASSWORD:password,MONGODB_DATABASE:db,APP_ORIGIN:'http://127.0.0.1:3001',TEST_ORIGIN:'http://127.0.0.1:3001',COOKIE_SECURE:'false'};
 await runNode('scripts/setup.mjs',env);
 await runNode('scripts/mongo-tests.mjs',env);
 web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3001'],{cwd:projectRoot,env,stdio:'inherit',windowsHide:true});
 let exited=false;web.on('exit',()=>{exited=true});
 for(let i=0;i<50;i++){
  if(exited)throw Error('QA web server exited');
  try{const r=await fetch(env.TEST_ORIGIN,{signal:AbortSignal.timeout(1000)});if(r.ok)break}catch{}
  if(i===49)throw Error('QA web server startup timed out');
  await new Promise(r=>setTimeout(r,300));
 }
 await runNode('scripts/integration.mjs',env);
 console.log('PASS: end-to-end verification used disposable SQL/Mongo databases only. Original demo records were preserved.');
}finally{
 web?.kill();
 if(mongo){await mongo.client.db(db).dropDatabase();await mongo.stop();}
 if(root){
  if(createdUser)await root.query('DROP USER '+mysql.escape(account)+"@'localhost'");
  if(createdSchema)await root.query('DROP DATABASE '+mysql.escapeId(db));
  await root.end();
 }
}

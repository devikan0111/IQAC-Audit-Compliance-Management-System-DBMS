import fs from 'node:fs/promises';
import vm from 'node:vm';
import mysql from 'mysql2/promise';
import {sqlStatements} from '../lib/sql-script.js';
import {MongoClient,ObjectId} from 'mongodb';
// Non-destructive MySQL extension. Core schema/seed remain explicit manual steps.
const c=await mysql.createConnection({host:process.env.MYSQL_HOST??'127.0.0.1',port:Number(process.env.MYSQL_PORT??3306),user:process.env.MYSQL_SETUP_USER??'root',password:process.env.MYSQL_SETUP_PASSWORD??'',database:process.env.MYSQL_DATABASE??'iqac_db'});
try{
 for(const filename of ['07_portal.sql','09_score_calculation.sql']){
 const sql=(await fs.readFile(new URL('../'+filename,import.meta.url),'utf8')).replace('USE iqac_db;','USE '+mysql.escapeId(process.env.MYSQL_DATABASE??'iqac_db')+';');
 for(const statement of sqlStatements(sql))await c.query(statement);
 }

 // DROP/CREATE PROCEDURE removes routine-specific grants in MySQL. Restore the
 // intended EXECUTE permission when re-running setup for an existing app account.
 const appUser=process.env.MYSQL_USER??'iqac_app';
 if(appUser!=='root'){
  const [accounts]=await c.execute("SELECT User FROM mysql.user WHERE User=? AND Host='localhost'",[appUser]);
  if(accounts.length)await c.query('GRANT EXECUTE ON PROCEDURE '+mysql.escapeId(process.env.MYSQL_DATABASE??'iqac_db')+'.sp_recalculate_scores TO '+mysql.escape(appUser)+"@'localhost'");
 }
 console.log('MySQL portal extension and scoring procedure installed.');
}finally{await c.end();}
const client=new MongoClient(process.env.MONGODB_URI??'mongodb://127.0.0.1:27017',{serverSelectionTimeoutMS:5000});
try{
 const db=client.db(process.env.MONGODB_DATABASE??'iqac_nosql');
 const names=(await db.listCollections().toArray()).map(x=>x.name);
 const existing=['faculty_evidence','department_evidence'].some(n=>names.includes(n));
 if(existing&&!process.argv.includes('--reset-mongo'))console.log('Existing Mongo evidence preserved. Use --reset-mongo ONLY to reset demo evidence.');
 else{
 const tasks=[];
 const proxy=new Proxy({}, {get(_target,key){
 if(key==='createCollection')return (name,options)=>tasks.push(()=>db.createCollection(name,options));
 if(key==='getCollectionNames')return ()=>[];
 return new Proxy({}, {get(_target,method){
 if(method==='countDocuments')return ()=>0;
 if(method==='getIndexes')return ()=>[];
 return (...args)=>tasks.push(async()=>{try{return await db.collection(key)[method](...args)}catch(e){if(method==='drop'&&e.code===26)return;throw e}});
 }});
 }});
 const script=await fs.readFile(new URL('../02_mongo_setup.js',import.meta.url),'utf8');
 vm.runInNewContext(script,{db:{getSiblingDB:()=>proxy},ObjectId:x=>new ObjectId(x),ISODate:x=>new Date(x),print:()=>{}},{timeout:1000});
 for(const task of tasks)await task();
 console.log('Mongo validators, indexes and fixed-ID seed installed.');
 }
}finally{await client.close();}

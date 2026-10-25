import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const docs={faculty_evidence:[],department_evidence:[]},validators={};
const proxy=new Proxy({}, {get(_target,key){
 if(key==='createCollection')return (name,options)=>{validators[name]=options.validator.$jsonSchema};
 if(key==='getCollectionNames')return ()=>Object.keys(docs);
 return {drop(){},createIndex(){},insertMany(rows){docs[key]=rows},countDocuments(){return docs[key].length},getIndexes(){return []}};
}});
vm.runInNewContext(fs.readFileSync(new URL('../02_mongo_setup.js',import.meta.url),'utf8'),{db:{getSiblingDB:()=>proxy},ObjectId:x=>x,ISODate:x=>new Date(x),print:()=>{}},{timeout:1000});
const sql=fs.readFileSync(new URL('../04_seed_data.sql',import.meta.url),'utf8');
test('All six Mongo faculty seed IDs and owners match the SQL inserts',()=>{
 assert.equal(docs.faculty_evidence.length,6);
 for(const d of docs.faculty_evidence){
 const start=sql.indexOf(' ('+d.mysql_submission_id+', '+d.faculty_id+',');
 assert(start>=0,'SQL faculty owner not found for '+d._id);
 const fragment=sql.slice(start,sql.indexOf('),',start)+2||undefined);
 assert(fragment.includes(d._id),'SQL Mongo link mismatch for '+d._id);
 assert(fragment.includes(d.title),'SQL/Mongo title mismatch');
 for(const key of validators.faculty_evidence.required)assert(key in d);
 }
});
test('All three Mongo department seed IDs map to SQL department records',()=>{
 assert.equal(docs.department_evidence.length,3);
 for(const d of docs.department_evidence){
 const rows=sql.slice(sql.indexOf('INSERT INTO Department_Metrics'),sql.indexOf('INSERT INTO Verification_Logs'));
 const start=rows.indexOf(' ('+d.mysql_dept_metric_id+', '+d.dept_id+',');
 assert(start>=0,'SQL department owner not found');
 const end=rows.indexOf('),',start),fragment=rows.slice(start,end<0?undefined:end+2);
 assert(fragment.includes(d._id),'SQL/Mongo department link mismatch');
 for(const key of validators.department_evidence.required)assert(key in d);
 }
});

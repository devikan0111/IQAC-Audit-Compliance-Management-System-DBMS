import {ObjectId} from 'mongodb';
import {pool,mongo} from './db.js';
export async function enqueue(c,collection,id,operation,payload=null){
 await c.execute('INSERT INTO Evidence_Outbox(collection_name,mongo_id,operation,payload) VALUES(?,?,?,?)',[collection,id,operation,payload?JSON.stringify(payload):null]);
}
export function bsonDocument(payload){
 const d=structuredClone(payload);
 d._id=new ObjectId(d._id);for(const key of ['created_at','updated_at'])if(d[key])d[key]=new Date(d[key]);
 if(d.details?.filing_date)d.details.filing_date=new Date(d.details.filing_date);
 return d;
}
export async function flushOutbox(limit=100){
 const c=await pool.getConnection();let processed=0,pending=0;
 try{
 for(let i=0;i<limit;i++){
 await c.beginTransaction();
 // Ordered queue and row locks keep concurrent workers from reordering mutations.
 const [jobs]=await c.query('SELECT * FROM Evidence_Outbox WHERE processed_at IS NULL ORDER BY outbox_id LIMIT 1 FOR UPDATE');
 if(!jobs.length){await c.commit();break;}
 const job=jobs[0];
 try{
 const collection=mongo().collection(job.collection_name);
 if(job.operation==='delete')await collection.deleteOne({_id:new ObjectId(job.mongo_id)});
 else await collection.replaceOne({_id:new ObjectId(job.mongo_id)},bsonDocument(typeof job.payload==='string'?JSON.parse(job.payload):job.payload),{upsert:true});
 await c.execute('UPDATE Evidence_Outbox SET processed_at=NOW(),last_error=NULL WHERE outbox_id=?',[job.outbox_id]);
 await c.commit();processed++;
 }catch(e){
 await c.execute('UPDATE Evidence_Outbox SET last_error=? WHERE outbox_id=?',[String(e.message).slice(0,500),job.outbox_id]);await c.commit();break;
 }
 }
 const [rows]=await c.query('SELECT COUNT(*) AS pending FROM Evidence_Outbox WHERE processed_at IS NULL');pending=Number(rows[0].pending);
 return {processed,pending};
 }catch(e){await c.rollback();throw e}
 finally{c.release();}
}
export async function latestEvidence(c,collection,id){
 const [jobs]=await c.execute('SELECT operation,payload FROM Evidence_Outbox WHERE collection_name=? AND mongo_id=? ORDER BY outbox_id DESC LIMIT 1',[collection,id]);
 if(jobs.length)return jobs[0].operation==='delete'?null:(typeof jobs[0].payload==='string'?JSON.parse(jobs[0].payload):jobs[0].payload);
 return mongo().collection(collection).findOne({_id:new ObjectId(id)});
}

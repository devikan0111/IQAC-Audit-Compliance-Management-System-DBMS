import assert from 'node:assert/strict';
import {MongoClient,ObjectId} from 'mongodb';
const client=new MongoClient(process.env.MONGODB_URI??'mongodb://127.0.0.1:27017',{serverSelectionTimeoutMS:5000});
const collection=client.db(process.env.MONGODB_DATABASE??'iqac_nosql').collection('faculty_evidence');
const invalidId=new ObjectId(),duplicateId=new ObjectId();
try{
 const seed=await collection.findOne({mysql_submission_id:1});assert(seed,'Load the Mongo seed before running this test');
 await assert.rejects(collection.insertOne({_id:invalidId,mysql_submission_id:2147483000,faculty_id:5,cycle_id:1,submission_type:'patent',title:'Invalid validation probe',authors:[{name:'Test'}],details:{patent_number:'IN1'},created_at:new Date()}),e=>e.code===121,'Missing patent_status must fail with Mongo validation error 121');
 await assert.rejects(collection.insertOne({...seed,_id:duplicateId}),e=>e.code===11000,'Duplicate MySQL link must fail with Mongo error 11000');
 console.log('PASS: type-specific validation (121) and unique SQL link (11000).');
}finally{
 await collection.deleteMany({_id:{$in:[invalidId,duplicateId]}});await client.close();
}

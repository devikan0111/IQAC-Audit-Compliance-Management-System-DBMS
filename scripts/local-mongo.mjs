import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {MongoClient} from 'mongodb';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export async function runNode(script,env=process.env){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script],{cwd:projectRoot,env,stdio:'inherit',windowsHide:true});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(script+' failed (exit '+code+')')));
 });
}
export async function localMongo(env=process.env){
 const uri=env.MONGODB_URI??'mongodb://127.0.0.1:27017';
 let client=new MongoClient(uri,{serverSelectionTimeoutMS:1500});
 try{await client.db('admin').command({ping:1});return {client,stop:()=>client.close()};}
 catch{await client.close();}
 if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):27017\/?$/.test(uri))throw Error('Start the MongoDB server configured in .env.local');
 const executable=new URL('../.runtime/mongodb/bin/mongod.exe',import.meta.url);
 if(!existsSync(executable))await runNode('scripts/download-mongo.mjs',env);
 const data=fileURLToPath(new URL('../.data/mongodb/',import.meta.url)),log=fileURLToPath(new URL('../.data/mongodb.log',import.meta.url));
 await fs.mkdir(data,{recursive:true});
 const child=spawn(fileURLToPath(executable),['--bind_ip','127.0.0.1','--port','27017','--dbpath',data,'--logpath',log,'--logappend'],{cwd:projectRoot,stdio:['ignore','ignore','pipe'],windowsHide:true});
 let exited=false;child.on('exit',()=>{exited=true});child.on('error',()=>{exited=true});

 try{
  // Wait for the socket first. A failed early driver connect must not be reused:
  // it can retain a closed topology while the native server is still starting.
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){
   if(exited)throw Error('MongoDB did not start; inspect .data/mongodb.log');
   ready=await new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port:27017});
    let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value)};
    socket.setTimeout(500);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));
   });
   if(ready)break;
   await new Promise(r=>setTimeout(r,250));
  }
  if(!ready)throw Error('MongoDB did not open port 27017. Inspect .data/mongodb.log');
  client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:5000});
  await client.db('admin').command({ping:1});
 }catch(e){child.kill();await client?.close();throw Error('MongoDB startup check failed: '+e.message)}
 return {client,async stop(){
  try{await client.db('admin').command({shutdown:1})}catch{}
  await client.close();
  if(!exited)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);
  if(!exited)child.kill();
 }};
}

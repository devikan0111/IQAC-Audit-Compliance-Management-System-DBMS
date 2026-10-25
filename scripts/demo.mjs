import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {localMongo,runNode,projectRoot} from './local-mongo.mjs';
let mongo,web,stopping=false;
async function stop(){
 if(stopping)return;stopping=true;
 if(web)web.kill();
 await mongo?.stop();
}
process.on('SIGINT',()=>stop().finally(()=>process.exit(0)));
process.on('SIGTERM',()=>stop().finally(()=>process.exit(0)));
try{
 if(!existsSync(new URL('../.next/BUILD_ID',import.meta.url)))throw Error('Run npm run build before starting the demo');
 mongo=await localMongo();
 console.log('MongoDB ready. Installing missing portal/evidence setup without resetting project data...');
 await runNode('scripts/setup.mjs');
 const origin=new URL(process.env.APP_ORIGIN??'http://localhost:3000');
 if(!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('This demo launcher supports localhost only');
 console.log('Open '+origin.origin+' in your browser. Keep this terminal running; Ctrl+C stops the demo.');
 web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',origin.port||'3000'],{cwd:projectRoot,env:process.env,stdio:'inherit',windowsHide:true});
 await new Promise((resolve,reject)=>{web.on('error',reject);web.on('exit',code=>code===0||stopping?resolve():reject(Error('Web server stopped (exit '+code+')')))});
}catch(e){console.error(e.message);process.exitCode=1}
finally{await stop()}

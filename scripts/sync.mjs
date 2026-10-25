import {flushOutbox} from '../lib/outbox.js';
import {pool} from '../lib/db.js';
try{const result=await flushOutbox(10000);console.log(result);if(result.pending)process.exitCode=1;}
finally{await pool.end();process.exit(process.exitCode??0);}

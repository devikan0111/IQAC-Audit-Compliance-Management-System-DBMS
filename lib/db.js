import mysql from 'mysql2/promise';
import {MongoClient} from 'mongodb';
export const pool=globalThis.iqacPool??mysql.createPool({
 host:process.env.MYSQL_HOST??'127.0.0.1',port:Number(process.env.MYSQL_PORT??3306),
 user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE??'iqac_db',
 connectionLimit:8,decimalNumbers:true,dateStrings:true,connectTimeout:5000,multipleStatements:false
});
if(process.env.NODE_ENV!=='production')globalThis.iqacPool=pool;
let client;
export function mongo(){client??=new MongoClient(process.env.MONGODB_URI??'mongodb://127.0.0.1:27017',{serverSelectionTimeoutMS:4000});return client.db(process.env.MONGODB_DATABASE??'iqac_nosql');}
export async function transaction(actor,fn){
 const c=await pool.getConnection();let locked=false;
 try{
 const [r]=await c.query("SELECT GET_LOCK('iqac_portal_write',10) AS acquired");if(Number(r[0].acquired)!==1)throw new Error('Database is busy; try again');
 locked=true;await c.beginTransaction();
 await c.query('SET @current_user_id = ?, @status_remarks = NULL',[actor?.user_id??null]);
 const result=await fn(c);await c.commit();return result;
 }catch(e){await c.rollback();throw e}
 finally{
 try{await c.query('SET @current_user_id = NULL, @status_remarks = NULL');if(locked)await c.query("DO RELEASE_LOCK('iqac_portal_write')");c.release();}
 catch{c.destroy();}
 }
}

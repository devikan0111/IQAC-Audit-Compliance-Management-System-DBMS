import {pool} from './db.js';
import {assert} from './policy.js';
import {statisticsQueries,statisticsResult} from './statistics.js';
export async function statistics(user,input){
 const q=statisticsQueries(user,input),c=await pool.getConnection();
 try{
  // One repeatable-read snapshot keeps chart totals consistent during reviews.
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const [cycles]=await c.execute('SELECT cycle_id,cycle_name,start_date,end_date,status FROM Audit_Cycles WHERE cycle_id=?',[q.filters.cycleId]);
  assert(cycles.length,'Audit cycle not found',404);
  if(q.filters.deptId!==null){const [d]=await c.execute('SELECT dept_id FROM Departments WHERE dept_id=?',[q.filters.deptId]);assert(d.length,'Department not found',404);}
  const rows={};
  for(const key of ['statuses','pending','monthly','scores','departments'])rows[key]=q[key]?(await c.execute(q[key].sql,q[key].params))[0]:null;
  await c.commit();return statisticsResult(q.filters,cycles[0],rows);
 }catch(e){await c.rollback();throw e}finally{c.release();}
}

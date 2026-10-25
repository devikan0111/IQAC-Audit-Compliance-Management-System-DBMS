import test from 'node:test';
import assert from 'node:assert/strict';
import {reportQueries,reportCsv} from '../lib/reports.js';
test('Faculty and HOD reports bind their department rather than trusting a UI filter',()=>{for(const role of ['Faculty','HOD']){const q=reportQueries({role,dept_id:2},1);for(const item of Object.values(q)){assert(item.sql.includes('WHERE d.dept_id=?'));assert.equal(item.params.at(-1),2);}}});
test('Auditor/Admin reports include departments with no matching records',()=>{for(const role of ['Auditor','Admin']){const q=reportQueries({role},1);for(const item of Object.values(q)){assert(item.sql.includes('FROM Departments d'));assert(item.sql.includes('LEFT JOIN'));assert(!item.sql.includes('WHERE d.dept_id=?'));}}});
test('Pending report aggregates each source before joining to avoid multiplication',()=>{const {sql,params}=reportQueries({role:'Auditor'},7).pending;assert.equal((sql.match(/GROUP BY/g)||[]).length,2);assert.deepEqual(params,[7,7]);});
test('Cycle input cannot become executable SQL',()=>{assert.throws(()=>reportQueries({role:'Auditor'},'1 OR 1=1'));assert.throws(()=>reportQueries({role:'Faculty',dept_id:null},1));});
test('CSV includes headers, preserves zero and distinguishes uncalculated scores',()=>{const csv=reportCsv('scores',[{dept_code:'ME',dept_name:'Mechanical',total_weighted_score:0,generated_at:null}]);assert(csv.includes('"0"'));assert(csv.includes('"Not calculated"'));assert(csv.startsWith('"Department"'));});
test('CSV escapes quotes and prevents spreadsheet formula execution',()=>{const csv=reportCsv('scores',[{dept_code:'=1+1',dept_name:'A "quoted" department',total_weighted_score:null,generated_at:null}]);assert(csv.includes('"\'=1+1"'));assert(csv.includes('A ""quoted"" department'));});

import test from 'node:test';
import assert from 'node:assert/strict';
import {statisticsFilters,statisticsQueries,statisticsResult,matchesRegister,reviewTargets} from '../lib/statistics.js';
const faculty={role:'Faculty',user_id:5,dept_id:1},hod={role:'HOD',user_id:3,dept_id:1},auditor={role:'Auditor',user_id:2};
test('Faculty statistics enforce owner scope even with no explicit filter',()=>{
 const q=statisticsQueries(faculty,{cycle_id:1});assert.equal(q.filters.kind,'faculty');
 assert.match(q.statuses.sql,/f.faculty_id=\?/);assert.deepEqual(q.statuses.params,[1,1,5]);assert.equal(q.scores,null);assert(!q.statuses.sql.includes('Department_Metrics'));
});
test('Local roles cannot request another department or department-only faculty data',()=>{
 for(const u of [faculty,hod])assert.throws(()=>statisticsQueries(u,{cycle_id:1,dept_id:2}),e=>e.status===403);
 assert.throws(()=>statisticsFilters(faculty,{cycle_id:1,kind:'department'}),e=>e.status===403);
});
test('Auditor can select one department with parameter-bound SQL and independent record kinds',()=>{
 const q=statisticsQueries(auditor,{cycle_id:1,dept_id:2});assert.deepEqual(q.statuses.params,[1,2,1,2]);assert.match(q.statuses.sql,/UNION ALL/);
 assert.equal(statisticsQueries(auditor,{cycle_id:1,kind:'department'}).monthly,null);
});
test('Statistics reject invalid identifiers, kinds and unknown roles',()=>{
 for(const cycle_id of ['',0,-1,'1 OR 1=1'])assert.throws(()=>statisticsFilters(auditor,{cycle_id}));
 assert.throws(()=>statisticsFilters(auditor,{cycle_id:1,kind:'unknown'}));
 assert.throws(()=>statisticsFilters({role:'Visitor'},{cycle_id:1}),e=>e.status===403);
});
const departments=[{dept_id:1,dept_code:'CSE',dept_name:'Computer Science'},{dept_id:2,dept_code:'ME',dept_name:'Mechanical'}];
function sample(){return statisticsResult({cycleId:1,kind:'all'},{status:'Active'},{
 statuses:[{kind:'faculty',status:'Submitted',count:'2'},{kind:'faculty',status:'Verified',count:1},{kind:'department',status:'Submitted',count:1},{kind:'faculty',status:'Approved',count:2}],
 pending:[{dept_id:1,kind:'faculty',status:'Submitted',count:2},{dept_id:1,kind:'faculty',status:'Verified',count:1},{dept_id:1,kind:'department',status:'Submitted',count:1},{dept_id:2,kind:null,status:null,count:0}],departments,
 monthly:[{month:'2026-01',count:'3'}],scores:[{dept_id:1,total_weighted_score:'0.00'},{dept_id:2,total_weighted_score:null}]});}
test('Snapshot totals count each current status once and separate review stages',()=>{
 const r=sample();assert.equal(r.summary.total,6);assert.equal(r.summary.pending,4);assert.equal(r.summary.approvalPercentage,33.3);
 assert.deepEqual(r.summary.counts,{Draft:0,Submitted:3,Verified:1,Approved:2,Rejected:0});
 assert.equal(r.backlog[0].waiting_for_hod,2);assert.equal(r.backlog[0].waiting_for_auditor,2);assert.equal(r.backlog[1].total,0);
 assert.equal(r.scores[0].total_weighted_score,0);assert.equal(r.scores[1].total_weighted_score,null);
});
test('Empty cycles do not invent an approval percentage or historical activity',()=>{
 const r=statisticsResult({}, {},{statuses:[],pending:[],departments,monthly:[],scores:[]});assert.equal(r.summary.total,0);assert.equal(r.summary.approvalPercentage,null);assert.equal(r.backlog[0].total,0);assert.deepEqual(r.monthly,[]);
});
test('Review shortcuts match HOD and Auditor permissions; Admin and inactive cycles have none',()=>{
 assert.equal(reviewTargets(hod,sample()).reduce((n,g)=>n+g.count,0),2);
 assert.equal(reviewTargets(auditor,sample()).reduce((n,g)=>n+g.count,0),2);
 assert.deepEqual(reviewTargets({role:'Admin'},sample()),[]);
 const locked=sample();locked.cycle.status='Locked';assert.deepEqual(reviewTargets(auditor,locked),[]);
});
test('Register drilldowns intersect cycle, department and multiple statuses',()=>{
 const row={cycle_id:1,dept_id:2,status:'Verified'};
 assert(matchesRegister(row,{cycleId:1,deptId:2,statuses:['Submitted','Verified']}));
 assert(!matchesRegister(row,{cycleId:2}));assert(!matchesRegister(row,{deptId:1}));assert(!matchesRegister(row,{statuses:['Submitted']}));
});

test('Monthly activity drilldown uses creation month and keeps other filters',()=>{const row={cycle_id:1,dept_id:1,status:'Draft',created_at:'2026-03-01 12:00:00'};assert(matchesRegister(row,{cycleId:1,createdMonth:'2026-03'}));assert(!matchesRegister(row,{cycleId:1,createdMonth:'2026-04'}));});

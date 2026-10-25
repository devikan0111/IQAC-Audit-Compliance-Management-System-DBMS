// Independent numeric reference for the documented SQL scoring policy.
// The database procedure is authoritative; this module supports offline tests.
import {assert} from './policy.js';
export function weightedScore(metrics,facultyScores={},departmentPercentages={}){
 const leaves=metrics.filter(m=>!metrics.some(child=>child.parent_metric_id===m.metric_id));
 const weight=leaves.reduce((n,m)=>n+Number(m.weightage),0);
 assert(Math.abs(weight-1)<0.0001,'Leaf metric weights must sum to 1.00');
 let points=0;
 for(const m of leaves){
 const max=Number(m.max_score);assert(max>0,'Metric maximum must be positive');
 let fraction;
 if(m.target_role==='Faculty'){
 const scores=facultyScores[m.metric_id]??[];
 assert(scores.every(s=>Number.isFinite(s)&&s>=0&&s<=max),'Invalid faculty score');
 fraction=Math.min(scores.reduce((a,b)=>a+b,0),max)/max;
 }else{
 const percentage=departmentPercentages[m.metric_id]??0;
 assert(Number.isFinite(percentage)&&percentage>=0&&percentage<=100,'Invalid department percentage');
 fraction=percentage/100;
 }
 points+=fraction*Number(m.weightage)*100;
 }
 return Math.round((points+Number.EPSILON)*100)/100;
}

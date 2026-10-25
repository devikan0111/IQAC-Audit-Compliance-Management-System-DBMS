import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {weightedScore} from '../lib/scoring.js';
import {sqlStatements} from '../lib/sql-script.js';
const seed=fs.readFileSync(new URL('../04_seed_data.sql',import.meta.url),'utf8');
const metrics=[];
for(const line of seed.split(/\r?\n/)){
 const m=line.match(/^\s*\((\d+),\s*(NULL|\d+),.*'(?:Quantitative|Qualitative)',\s*([0-9.]+),\s*([0-9.]+),\s*'(Faculty|HOD)'/);
 if(m)metrics.push({metric_id:Number(m[1]),parent_metric_id:m[2]==='NULL'?null:Number(m[2]),max_score:Number(m[3]),weightage:Number(m[4]),target_role:m[5]});
}
test('Seed metrics use all 20 hierarchy rows and 8 leaves',()=>{assert.equal(metrics.length,20);assert.equal(metrics.filter(m=>!metrics.some(c=>c.parent_metric_id===m.metric_id)).length,8)});
test('Original approved seed produces CSE 31.25, ECE 19.50, ME zero',()=>{assert.equal(weightedScore(metrics,{5:[18]},{17:88.33}),31.25);assert.equal(weightedScore(metrics,{9:[8],11:[7.5]}),19.5);assert.equal(weightedScore(metrics),0)});
test('Multiple faculty claims cap at the metric maximum',()=>{assert.equal(weightedScore(metrics,{5:[18,18,18]}),20);assert.equal(weightedScore(metrics,{5:[10,10]}),20)});
test('Every leaf at its maximum yields exactly 100 with parents excluded',()=>{const faculty={},department={};for(const m of metrics){if(metrics.some(c=>c.parent_metric_id===m.metric_id))continue;if(m.target_role==='Faculty')faculty[m.metric_id]=[m.max_score];else department[m.metric_id]=100;}assert.equal(weightedScore(metrics,faculty,department),100)});
test('Missing metrics contribute zero without redistributing their weights',()=>{assert.equal(weightedScore(metrics,{}, {17:50}),7.5)});
test('Weights and invalid scores fail rather than producing misleading totals',()=>{assert.throws(()=>weightedScore(metrics.map(m=>({...m,weightage:m.weightage*2}))),/sum to 1/);assert.throws(()=>weightedScore(metrics,{5:[21]}),/Invalid/);assert.throws(()=>weightedScore(metrics,{}, {17:101}),/Invalid/)});
test('Procedure keeps caller transaction ownership and has the scoring guards',()=>{const statements=sqlStatements(fs.readFileSync(new URL('../09_score_calculation.sql',import.meta.url),'utf8'));const routine=statements.find(s=>s.startsWith('CREATE PROCEDURE sp_recalculate_scores'));assert(routine);assert(!/\b(?:START TRANSACTION|COMMIT|ROLLBACK)\b/.test(routine));assert(routine.includes("v_role NOT IN ('Auditor','Admin')"));assert(routine.includes('ON DUPLICATE KEY UPDATE'));assert(routine.includes('LEAST(COALESCE(f.total_score,0),m.max_score)'));assert(routine.includes('child.parent_metric_id=m.metric_id'));});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sqlStatements} from '../lib/sql-script.js';
test('Portal migration is split without breaking trigger bodies',()=>{
 const statements=sqlStatements(fs.readFileSync(new URL('../07_portal.sql',import.meta.url),'utf8'));
 assert.equal(statements.length,10);
 const triggers=statements.filter(s=>s.startsWith('CREATE TRIGGER'));
 assert.equal(triggers.length,3);
 assert(triggers.every(s=>s.includes("SIGNAL SQLSTATE '45000'")&&s.endsWith('END')));
 assert(statements.every(s=>!s.includes('DELIMITER ')));
});
test('Corrected trigger script retains all routines and the self-parent insert guard',()=>{
 const statements=sqlStatements(fs.readFileSync(new URL('../06_triggers.sql',import.meta.url),'utf8'));
 assert.equal(statements.filter(s=>s.startsWith('CREATE TRIGGER')).length,16);
 assert.equal(statements.filter(s=>s.startsWith('CREATE FUNCTION')).length,2);
 assert.equal(statements.filter(s=>s.startsWith('CREATE PROCEDURE')).length,1);
 const insertGuard=statements.find(s=>s.startsWith('CREATE TRIGGER trg_metric_ai'));
 assert(insertGuard.includes('NEW.parent_metric_id = NEW.metric_id'));
});
test('Incomplete migration statements fail before database execution',()=>{assert.throws(()=>sqlStatements('CREATE TABLE unfinished ('),/Unterminated/);assert.throws(()=>sqlStatements('SELECT 1\nDELIMITER $$'),/Delimiter/)});

import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,digest} from '../lib/password.js';
test('Legacy SHA2 seed credentials verify without accepting wrong passwords',async()=>{assert.equal(await verifyPassword('Pass@123',digest('Pass@123')),true);assert.equal(await verifyPassword('wrong',digest('Pass@123')),false)});
test('Scrypt hashes use fresh salts and validate passwords',async()=>{const a=await hashPassword('Pass@123'),b=await hashPassword('Pass@123');assert.notEqual(a,b);assert.equal(await verifyPassword('Pass@123',a),true);assert.equal(await verifyPassword('wrong',a),false)});
test('Unknown password encodings are rejected',async()=>{assert.equal(await verifyPassword('anything','unrecognized'),false)});

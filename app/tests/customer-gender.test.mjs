import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestNameGender} from '../scripts/classify-customer-gender.mjs';

test('customer gender suggestions use deterministic local names and keep unknowns unverified',()=>{
 assert.equal(suggestNameGender('Mary Wanjiku').gender,'female');
 assert.equal(suggestNameGender('John Kamau').gender,'male');
 assert.equal(suggestNameGender('A. N. Customer').gender,null);
 assert.equal(suggestNameGender('Xyzzy Example').gender,null);
});

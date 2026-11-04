import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,parseSupplyCsv} from '../farmer-supply.mjs';

test('farmer supply matching normalizes Kenyan local, international and nine-digit source phones',()=>{
 assert.equal(normalizePhone('0712 345 678'),'+254712345678');
 assert.equal(normalizePhone('+254 712 345 678'),'+254712345678');
 assert.equal(normalizePhone('712345678'),'+254712345678');
 assert.equal(normalizePhone('not a phone'),null);
});

test('farmer supply CSV preserves source expressions and missing values',()=>{
 const rows=parseSupplyCsv('source_row,source_name,source_phone,source_category,supply_date,quantity_liters,original_value\n4,Example,712345678,Satima Farmers,2026-10-04,31.5,"41.5-10=31.5"\n4,Example,712345678,Satima Farmers,2026-10-11,,');
 assert.equal(rows.length,2);
 assert.equal(rows[0].original_value,'41.5-10=31.5');
 assert.equal(rows[1].quantity_liters,'');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {completeMonth,businessReport,latestBusinessMonth} from '../business-reporting.mjs';

test('historical actuals apply only to complete source months, never inferred days',async()=>{
 assert.equal(completeMonth('2026-09-01','2026-09-30'),'2026-09');
 assert.equal(completeMonth('2026-09-01','2026-09-29'),null);
 assert.equal(completeMonth('2026-09-02','2026-09-30'),null);
 assert.equal(completeMonth('2028-02-01','2028-02-29'),'2028-02');
 let queried=false;
 const db={query(){queried=true;throw new Error('Historical table should not be read for partial range');}};
 assert.equal((await businessReport(db,'2026-09-01','2026-09-07')).source,'operations');
 assert.equal(queried,false);
});

test('unimported full months use recorded operations and current defaults follow the newest real month',async()=>{
 const db={async query(sql){if(sql.includes('max(month)'))return {rows:[{month:'2026-10-01'}]};return {rows:[]};}};
 assert.equal(await latestBusinessMonth(db),'2026-10');
 const choice=await businessReport(db,'2026-10-01','2026-10-31');
 assert.equal(choice.source,'operations');
 assert.equal(choice.report,null);
});

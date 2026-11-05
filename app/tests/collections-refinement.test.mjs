import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichHome,homeSummary,validateReview} from '../collections-refinement.mjs';
import {exportCsv} from '../collections.mjs';
const records=[{row:2,name:'Fictional A',amount:10.1,balance:10.1,group:'Unpaid'},{row:3,name:'Fictional B',amount:20.2,balance:20.2,group:'Unpaid'},{row:4,name:'Fictional C',amount:30,balance:0,group:'Paid'}];
const metadata=records.map(r=>({source_row:r.row,source_overdue:r.row<4,style_evidence:r.row<4?[{cell:'A'+r.row,rgb:'FFFF0000'}]:[]}));
test('source overdue evidence and staff decisions remain separate; dates stay unknown',()=>{
 const enriched=enrichHome(records,metadata,[{source_row:2,id:'7',overdue_state:'not_overdue',follow_up_stage:'contacted'}]);
 assert.equal(enriched[0].sourceOverdue,true);assert.equal(enriched[0].overdueState,'not_overdue');assert.equal(enriched[2].overdueState,'not_flagged');
 const summary=homeSummary(enriched);assert.equal(summary.sourceFlaggedBalance,30.3);assert.equal(summary.currentOverdueListed,20.2);assert.equal(summary.dueDateUnknownCount,3);assert.equal(summary.followUpsRecorded,1);
 assert(enriched.every(r=>r.invoiceDate===null&&r.invoiceMonth===null&&r.dueDate===null));
 assert.equal(exportCsv(enriched,new URLSearchParams({overdue:'source'})).split('\r\n').length,3);
 assert.equal(exportCsv(enriched,new URLSearchParams({overdue:'current'})).split('\r\n').length,2);
});
test('missing evidence is not silently reported as zero overdue',()=>{const rows=enrichHome(records,[],[]);assert.equal(rows[0].overdueState,'unknown');assert.equal(homeSummary(rows).sourceFlaggedBalance,null);});
test('review requires a valid state, named reviewer, reason and concurrency revision',()=>{
 const valid={overdueState:'overdue',reviewerName:'Test Reviewer',reason:'Confirmed source evidence',expectedRevision:'0',followUpStage:null};assert.equal(validateReview(valid).expectedRevision,'0');
 for(const change of [{overdueState:'paid'},{reason:'x'},{reviewerName:''},{expectedRevision:0},{followUpStage:'send_legal_notice'}])assert.throws(()=>validateReview({...valid,...change}),e=>e.status===400);
});

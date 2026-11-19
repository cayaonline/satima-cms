import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const js=await readFile(new URL('../public/collections-simple.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/collections-simple.css',import.meta.url),'utf8');

test('Overview renders sections in the required October-to-ageing order and lists all four source months',()=>{
 const overview=js.slice(js.indexOf("if(view==='overview')"),js.indexOf("}else if(view==='home')"));
 const order=['October 2026 Invoicing','Monthly Source Reports','metric(\'Invoiced\'','metric(\'Collected\'','metric(\'Outstanding\'','metric(\'Overdue\'','Collections Action Board','Receivables Ageing'];
 let previous=-1;
 for(const text of order){const next=overview.indexOf(text);assert.ok(next>previous,`${text} must follow the prior Overview section`);previous=next;}
 for(const month of ['2026-07','2026-08','2026-09','2026-10'])assert.ok(overview.includes(month),`${month} source report is present`);
 assert.match(overview,/Source document not imported/);
});

test('Home Customer UI offers All, Paid and Unpaid filters and only Paid or Unpaid stored choices',()=>{
 assert.match(js,/<option value="All">All<\/option><option value="Paid">Paid<\/option><option value="Unpaid">Unpaid<\/option>/);
 assert.match(js,/<option value="Paid" \$\{status==='Paid'\?'selected':''\}>Paid<\/option><option value="Unpaid"/);
 assert.match(js,/Status conflicts with the recorded invoice balance/);
 assert.match(js,/Source payment labels are kept separate from the invoice ledger/);
});

test('Collections uses CMS inherited typography and responsive section layouts',()=>{
 assert.match(css,/\.simple-heading h1\{font-family:inherit/);
 assert.match(css,/@media\(max-width:700px\).*\.simple-report/);
 assert.match(css,/\.simple-aging-list/);
});

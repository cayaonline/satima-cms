import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('shared date presentation keeps ISO storage separate from DD/MM/YYYY display',()=>{
 const source=readFileSync(new URL('../public/dates.js',import.meta.url),'utf8');
 const window={},document={addEventListener(){}},MutationObserver=class{observe(){}};
 vm.runInNewContext(source,{window,document,MutationObserver,Intl,Date,Event});
 const dates=window.satimaDates;
 assert.equal(dates.format('2026-10-16'),'16/10/2026');
 assert.equal(dates.parse('16/10/2026'),'2026-10-16');
 assert.equal(dates.parse('31/02/2026'),null);
 assert.equal(dates.formatDateTime('2026-10-15T21:30:00Z'),'16/10/2026 00:30');
 assert.match(dates.today(),/^\d{4}-\d{2}-\d{2}$/);
 const week=dates.preset('weekly');
 assert.equal(new Date(week.from+'T12:00:00Z').getUTCDay(),1);
 assert.equal(new Date(week.to+'T12:00:00Z').getUTCDay(),0);
});

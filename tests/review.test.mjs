import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { refresh } from '../src/engine.mjs';
import { createReview, pageOf, shortText } from '../src/review.mjs';
import { readZip } from '../src/zip.mjs';
const fixture = () => refresh(fs.readFileSync('fixtures/demo-updated.mm'), fs.readFileSync('fixtures/calc-7.3.7.2-annotated.xlsx'));
test('review exposes exact before/after move and label with independent unchanged annotation strings', () => {
 const review = createReview(fixture()); assert.deepEqual(review.counts,{ all:6,active:5,removed:1,added:1,renamed:1,moved:1,restored:0,structure:0,unchanged:3 });
 const row=pageOf(review,{filter:'moved'}).rows[0]; assert.equal(row.id,'ID_1000004');assert.deepEqual(row.changes,['renamed','moved']);assert.deepEqual(row.before,{label:'Alpha',parent:'ID_1000002',path:'["Catalog","Products","Alpha"]',depth:2,order:3});assert.deepEqual(row.annotations,['007','line1\nline2','=1+1']);assert.equal(pageOf(review,{filter:'removed'}).rows[0].id,'ID_1000005');
});
test('worker review pages are capped at 50 and every query is bounded', () => {
 const rows=Array.from({length:20000},(_,i)=>({id:'N'+i,label:'Label'+i,changes:['unchanged'],sheet:'Active'})),review={rows};
 assert.equal(pageOf(review).rows.length,50);assert.equal(pageOf(review,{page:9999}).page,399);assert.equal(pageOf(review,{page:399}).rows.at(-1).id,'N19999');assert.equal(pageOf(review,{search:'label12345'}).total,1);
 for(const query of [{page:-1},{page:NaN},{search:'x'.repeat(257)},{filter:'unknown'}])assert.throws(()=>pageOf(review,query));
 assert.equal(shortText('a'.repeat(179)+'🧭rest',180),'a'.repeat(179)+'…');
});
test('multiline workbook rows have explicit readable heights without altering strings', () => {
 const result=fixture(),sheet=new Map(readZip(result.workbook)).get('xl/worksheets/sheet1.xml');assert.match(sheet,/<row r="6" ht="44" customHeight="1">/);assert.deepEqual(result.data.active.at(-1).annotations,['007','line1\nline2','=1+1']);
});
test('actual bundled worker returns deterministic XLSX and hashes, rejects family mismatch without echo', async () => {
 const outputs=[],scope={postMessage:message=>outputs.push(message)},context=vm.createContext({self:scope,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Int32Array,DataView,ArrayBuffer,console,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync('.build/worker.js','utf8'),context,{timeout:1000});
 const map=new Uint8Array(fs.readFileSync('fixtures/demo-updated.mm')),prior=new Uint8Array(fs.readFileSync('fixtures/calc-7.3.7.2-annotated.xlsx'));
 await scope.onmessage({data:{type:'build',id:1,map,prior}});const result=outputs.pop();assert.equal(result.type,'built');assert.deepEqual(result.workbook,fixture().workbook);assert.match(result.receipt.mapSHA256,/^[0-9a-f]{64}$/);assert.equal(result.page.rows.length,6);assert.deepEqual(Array.from(result.receipt.otherTreeChangeIds),[]);
 await scope.onmessage({data:{type:'page',id:2,query:{filter:'moved'}}});assert.equal(outputs.pop().page.rows[0].label,'Beta');
 await scope.onmessage({data:{type:'build',id:4,map:new TextEncoder().encode(new TextDecoder().decode(map).replace('TEXT="Catalog"','TEXT="Renamed root"')),prior}});assert.deepEqual(Array.from(outputs.pop().receipt.otherTreeChangeIds),['ID_1000002','ID_1000003']);
 await scope.onmessage({data:{type:'build',id:3,map:new TextEncoder().encode('<map><node ID="SECRET_ROOT" TEXT="PRIVATE_TEXT"/></map>'),prior}});const error=outputs.pop();assert.equal(error.reason,'family');assert.equal(JSON.stringify(error).includes('PRIVATE'),false);
});

test('ancestor renames and sibling reorder do not incorrectly mark reserved tree changes as unchanged', () => {
 const old=new TextEncoder().encode('<map><node ID="R" TEXT="Old"><node ID="A" TEXT="Alpha"/><node ID="B" TEXT="Beta"/></node></map>');
 const now=new TextEncoder().encode('<map><node ID="R" TEXT="New"><node ID="B" TEXT="Beta"/><node ID="A" TEXT="Alpha"/></node></map>');
 const review=createReview(refresh(now,refresh(old).workbook));assert.equal(review.counts.structure,2);assert.equal(review.counts.unchanged,0);const rows=pageOf(review,{filter:'structure'}).rows;assert.deepEqual(rows.map(r=>r.id),['B','A']);assert.equal(rows[0].before.order,3);assert.equal(rows[0].order,2);assert.equal(rows[0].before.path,'["Old","Beta"]');assert.equal(rows[0].path,'["New","Beta"]');
});

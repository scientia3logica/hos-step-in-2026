import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {api} from './api.mjs';
import {localBucket} from './local-bucket.mjs';
const origin='https://test.example';
const request=(path,options={})=>new Request(origin+path,{...options,headers:{Origin:origin,...options.headers}});
test('shared post and upload survive adapter restart; delete is restricted and cleans files',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-data-'));
 try{
 const env={BUCKET:localBucket(directory)};const form=new FormData();
 for(const [k,v] of Object.entries({kind:'result',nickname:'테스트',title:'실험 결과',body:'한글 내용 <script> 그대로 텍스트'}))form.set(k,v);
 form.set('file',new File(['sample file'],'결과.txt',{type:'text/plain'}));
 let response=await api(request('/api/posts',{method:'POST',body:form}),env);assert.equal(response.status,201);const created=await response.json();
 const restarted={BUCKET:localBucket(directory)};
 response=await api(request('/api/posts?kind=result'),restarted);const posts=await response.json();assert.equal(posts.length,1);assert.equal(posts[0].title,'실험 결과');assert.equal(posts[0].deleteKey,undefined);
 response=await api(request('/api/files/'+created.id),restarted);assert.equal(await response.text(),'sample file');assert.ok(response.headers.get('Content-Disposition').startsWith('attachment'));
 response=await api(request('/api/posts/'+created.id,{method:'DELETE',headers:{'X-Delete-Key':'wrong'}}),restarted);assert.equal(response.status,403);
 response=await api(request('/api/posts/'+created.id,{method:'DELETE',headers:{'X-Delete-Key':created.deleteKey}}),restarted);assert.equal(response.status,200);
 response=await api(request('/api/posts?kind=result'),restarted);assert.deepEqual(await response.json(),[]);
 response=await api(request('/api/files/'+created.id),restarted);assert.equal(response.status,404);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('reject cross-origin and incomplete submissions',async()=>{
 const bad=await api(new Request(origin+'/api/posts',{method:'POST',headers:{Origin:'https://other.example'}}),{BUCKET:{}});assert.equal(bad.status,403);
 const badForm=await api(request('/api/posts',{method:'POST',body:new FormData()}),{BUCKET:{}});assert.equal(badForm.status,400);
});
test('frontend scripts parse and source links resolve',async()=>{
 for(const f of ['app','community'])new Function(await readFile(`${f}.js`,'utf8'));
 const html=await readFile('index.html','utf8');assert.ok(!/claude\.ai\/login/.test(html),'no Claude login link');for(const [,id]of html.matchAll(/href="#([^"]+)"/g))assert.ok(html.includes(`id="${id}"`));
});

test('standalone shared storage: collections, delete keys, dimensions and blobs work without login',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-data-'));
 try{
 const env={BUCKET:localBucket(directory)};const call=(path,options)=>api(request(path,options),env);
 const post=(col,body)=>call('/api/db/'+col,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
 assert.equal((await call('/api/health')).status,200);
 let r=await post('messages',{ch:'talk',nick:'학생',text:'안녕 <b>',createdAt:1});assert.equal(r.status,201);const m=await r.json();
 await post('messages',{ch:'idea',nick:'학생2',text:'두 번째'});
 r=await call('/api/db/messages?limit=100');let list=await r.json();assert.equal(list.length,2);assert.equal(list[0].text,'두 번째');assert.equal(list[1].deleteKey,undefined);assert.ok(list[1].createdAt>1);
 assert.equal((await call('/api/db/messages',{headers:{'If-None-Match':r.headers.get('ETag')}})).status,200,'different limit, different tag');
 assert.equal((await call('/api/db/messages?limit=100',{headers:{'If-None-Match':r.headers.get('ETag')}})).status,304);
 assert.equal((await post('messages',{ch:'talk',nick:'',text:'x'})).status,400);
 assert.equal((await call('/api/db/messages/'+m.id,{method:'DELETE',headers:{'X-Delete-Key':'nope'}})).status,403);
 assert.equal((await call('/api/db/messages/'+m.id,{method:'DELETE',headers:{'X-Delete-Key':m.deleteKey}})).status,200);
 // concurrent writers do not lose items
 await Promise.all(Array.from({length:8},(_,i)=>post('messages',{ch:'talk',nick:'n'+i,text:'t'+i})));
 assert.equal((await (await call('/api/db/messages')).json()).length,9);
 // blob + model; anyone can delete a model and its file goes with it
 r=await call('/api/blob',{method:'POST',body:'solid x',headers:{'Content-Type':'model/stl'}});assert.equal(r.status,201);const {id:blob}=await r.json();
 r=await call('/_blob/'+blob);assert.equal(await r.text(),'solid x');assert.equal(r.headers.get('Content-Type'),'application/octet-stream');assert.match(r.headers.get('Content-Security-Policy'),/sandbox/);
 r=await post('models',{author:'a',name:'캡',fileName:'cap.stl',size:7,assetId:blob});assert.equal(r.status,201);const model=await r.json();
 assert.equal((await post('models',{author:'a',fileName:'x.stl',assetId:'bmissing000000'})).status,400);
 assert.equal((await call('/api/db/models/'+model.id,{method:'DELETE'})).status,200);
 assert.equal((await call('/_blob/'+blob)).status,404);
 // experiment logs require the author's key
 r=await post('explogs',{expDate:'2026-11-11',author:'a',body:'실험'});const log=await r.json();
 assert.equal((await call('/api/db/explogs/'+log.id,{method:'DELETE'})).status,403);
 // dimensions
 assert.deepEqual(await (await call('/api/db/lab/dimensions')).json(),{data:null});
 assert.equal((await call('/api/db/lab/dimensions',{method:'PUT',body:JSON.stringify({reach:1,height:110,od:20})})).status,400);
 assert.equal((await call('/api/db/lab/dimensions',{method:'PUT',body:JSON.stringify({reach:90,height:110,od:20})})).status,200);
 assert.equal((await (await call('/api/db/lab/dimensions')).json()).data.reach,90);
 }finally{await rm(directory,{recursive:true,force:true});}
});

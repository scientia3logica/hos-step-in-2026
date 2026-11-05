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
 const html=await readFile('index.html','utf8');for(const [,id]of html.matchAll(/href="#([^"]+)"/g))assert.ok(html.includes(`id="${id}"`));
});

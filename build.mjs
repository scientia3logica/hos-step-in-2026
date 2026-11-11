import {readFile,mkdir,writeFile,rm,copyFile} from 'node:fs/promises';
let page=await readFile('index.html','utf8');
{const css=await readFile('styles.css','utf8');page=page.replace('<link rel="stylesheet" href="/styles.css">',()=>'<style>'+css+'</style>');}
for(const name of ['community','app']) {const code=await readFile(`${name}.js`,'utf8');page=page.replace(`<script src="/${name}.js" defer></script>`,()=>'<script>'+code+'</script>');}
const api=(await readFile('api.mjs','utf8')).replace('export async function api','async function api');
const output='const PAGE='+JSON.stringify(page)+';\n'+api+`\nexport default {async fetch(request,env){try{const path=new URL(request.url).pathname;if(path.startsWith('/api/')||path.startsWith('/_blob/'))return await api(request,env);if(path!=='/')return new Response('Not found',{status:404});return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}});}catch(e){console.error(e);return Response.json({error:'처리하지 못했습니다. 잠시 후 다시 시도하세요.'},{status:500});}}};\n`;
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});await mkdir('worker',{recursive:true});
await writeFile('worker/index.js',output);await writeFile('dist/server/index.js',output);
console.log('Built standalone Worker and Sites artifact');

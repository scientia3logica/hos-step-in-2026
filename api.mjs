const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const kinds=['chat','proposal','result','model'];const idPattern=/^\d{13}-[a-f0-9-]{36}$/;
const types={stl:'application/octet-stream',obj:'application/octet-stream',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',hwp:'application/octet-stream',hwpx:'application/octet-stream',txt:'text/plain',csv:'text/csv',zip:'application/zip'};
export async function api(request,env){const url=new URL(request.url),path=url.pathname;const bucket=env.BUCKET;if(!bucket)return json({error:'공용 저장소를 준비하고 있습니다.'},503);if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin)return json({error:'잘못된 요청입니다.'},403);
if(path==='/api/health'||path==='/api/blob'||path.startsWith('/api/db/')||path.startsWith('/_blob/'))return shared(request,env,url);
if(path==='/api/dimensions'){if(request.method==='GET'){const o=await bucket.get('shared/dimensions');return json(o?await o.json():{reach:125,height:229,diameter:28});}if(request.method==='PUT'){const d=await request.json();for(const k of ['reach','height','diameter'])if(!Number.isFinite(d[k])||d[k]<10||d[k]>500)return json({error:'치수는 10~500mm 범위입니다.'},400);await bucket.put('shared/dimensions',JSON.stringify(d));return json(d);}}
if(path==='/api/posts'&&request.method==='GET'){const kind=url.searchParams.get('kind');if(!kinds.includes(kind))return json({error:'분류 오류'},400);const items=await bucket.list({prefix:'posts/'+kind+'/',limit:100,});return json((await Promise.all(items.objects.map(async o=>{const item=await bucket.get(o.key);if(!item)return null;const {deleteKey,...post}=await item.json();return post;}))).filter(Boolean));}
if(path==='/api/posts'&&request.method==='POST'){if(Number(request.headers.get('Content-Length'))>51*1048576)return json({error:'파일은 50MB 이하로 올려 주세요.'},413);const f=await request.formData(),kind=f.get('kind'),nickname=String(f.get('nickname')||'').trim(),body=String(f.get('body')||'').trim(),title=String(f.get('title')||'').trim();if(!kinds.includes(kind)||!nickname||nickname.length>30||!body||body.length>4000||title.length>100||(kind!=='chat'&&!title))return json({error:'닉네임, 제목과 내용을 확인하세요.'},400);if(kind==='model'){const m=f.get('file');if(!m||typeof m==='string'||!m.size||m.size>50*1048576||! /\.(stl|obj|jpg|jpeg|png|webp|mp4|webm)$/i.test(m.name))return json({error:'50MB 이하 모델·사진·영상 파일이 필요합니다.'},400);}const id=Date.now()+'-'+crypto.randomUUID(),deleteKey=crypto.randomUUID()+crypto.randomUUID(),post={id,kind,nickname,body,title,created:new Date().toISOString(),file:null};const file=f.get('file');if(file&&typeof file!=='string'&&file.size){const ext=file.name.split('.').pop().toLowerCase();if(!types[ext]||file.size>50*1048576)return json({error:'지원하는 형식의 50MB 이하 파일을 선택하세요.'},400);post.file={name:file.name.slice(0,180),type:types[ext],size:file.size};await bucket.put('files/'+id,file.stream(),{httpMetadata:{contentType:types[ext]}});}const key='posts/'+kind+'/'+String(9999999999999-Number(id.slice(0,13))).padStart(13,'0')+'-'+id;try{await bucket.put(key,JSON.stringify({...post,deleteKey}));await bucket.put('lookup/'+id,JSON.stringify({key,deleteKey,file:post.file}));}catch(e){await bucket.delete('files/'+id);await bucket.delete(key);throw e;}return json({id,deleteKey},201);}
const match=path.match(/^\/api\/(posts|files)\/(.+)$/);if(match&&idPattern.test(match[2])){const [,kind,id]=match,lookup=await bucket.get('lookup/'+id);if(!lookup)return json({error:'찾을 수 없습니다.'},404);const meta=await lookup.json();if(kind==='posts'&&request.method==='DELETE'){if(!meta.key.startsWith('posts/model/')&&request.headers.get('X-Delete-Key')!==meta.deleteKey)return json({error:'삭제 권한이 없습니다.'},403);await bucket.delete([meta.key,'files/'+id,'lookup/'+id]);return json({ok:true});}if(kind==='files'&&request.method==='GET'&&meta.file){const o=await bucket.get('files/'+id,{range:request.headers});if(!o)return json({error:'파일 없음'},404);const headers=new Headers({'Content-Type':meta.file.type,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600','Accept-Ranges':'bytes','Content-Disposition':(meta.file.type.startsWith('image/')||meta.file.type.startsWith('video/')?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(meta.file.name)});let status=200;if(o.range){status=206;headers.set('Content-Range',`bytes ${o.range.offset}-${o.range.offset+o.range.length-1}/${o.size}`);headers.set('Content-Length',String(o.range.length));}return new Response(o.body,{status,headers});}}return json({error:'찾을 수 없습니다.'},404);}


// ---- Shared storage for the standalone site (replaces the Claude artifact runtime; no login) ----
const COLS={
 messages:{max:1000,full:'drop',clean:d=>{const ch=String(d.ch||'talk');const nick=str(d.nick,20),text=str(d.text,500);if(!['talk','idea','result'].includes(ch)||!nick||!text)return null;return {ch,nick,text};}},
 models:{max:300,full:'reject',clean:d=>{const author=str(d.author,20),fileName=str(d.fileName,200);if(!author||!fileName||!blobId(d.assetId))return null;return {author,name:str(d.name,120)||fileName,desc:str(d.desc,300),fileName,size:Math.max(0,Math.floor(Number(d.size)||0)),contentType:str(d.contentType,100),assetId:d.assetId,wrapped:!!d.wrapped};}},
 explogs:{max:1000,full:'reject',clean:d=>{const expDate=String(d.expDate||''),author=str(d.author,20),body=str(d.body,2000);if(!/^\d{4}-\d{2}-\d{2}$/.test(expDate)||!author||!body)return null;const o={expDate,author,body};if(d.imageId!=null){if(!blobId(d.imageId))return null;o.imageId=d.imageId;o.imageName=str(d.imageName,200);}return o;}}
};
const MAX_BLOB=20*1048576;
const INLINE=/^(image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)|video\/(mp4|webm|quicktime|x-m4v))$/;
const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const blobId=v=>typeof v==='string'&&/^b[a-z0-9]{10,40}$/.test(v);
const docId=v=>/^d[a-z0-9]{10,40}$/.test(v);
const newId=p=>p+Date.now().toString(36)+crypto.randomUUID().replace(/-/g,'').slice(0,16);
const err=(error,code,status)=>json({error,code},status);
async function readCol(bucket,name){const o=await bucket.get('db/'+name);return {obj:o,data:o?await o.json():{items:[]}};}
// Read-modify-write with an ETag check so concurrent writers do not overwrite each other.
async function mutate(bucket,key,fn){for(let i=0;i<8;i++){const o=await bucket.get(key);const data=o?await o.json():null;const out=fn(data);if(out.error)return out;const put=await bucket.put(key,JSON.stringify(out.data),o?{onlyIf:{etagMatches:o.etag}}:undefined);if(put)return out;await new Promise(r=>setTimeout(r,20+Math.random()*80));}return {error:err('동시에 저장하는 사람이 많아요. 다시 시도해 주세요.','busy',409)};}
const removeBlobs=(bucket,ids)=>Promise.all(ids.filter(blobId).map(id=>bucket.delete(['blobs/'+id,'blobmeta/'+id])));
async function shared(request,env,url){
 const bucket=env.BUCKET,path=url.pathname,m=request.method;
 if(path==='/api/health')return json({ok:true});
 if(path==='/api/blob'&&m==='POST'){
  if(Number(request.headers.get('Content-Length'))>MAX_BLOB)return err('파일이 너무 커요. 20MB 이하로 줄여 주세요.','too_large',413);
  const buf=await request.arrayBuffer();if(!buf.byteLength)return err('빈 파일이에요.','empty',400);if(buf.byteLength>MAX_BLOB)return err('파일이 너무 커요. 20MB 이하로 줄여 주세요.','too_large',413);
  const t=String(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase(),type=/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t)?t:'application/octet-stream';
  const id=newId('b');await bucket.put('blobs/'+id,buf);await bucket.put('blobmeta/'+id,JSON.stringify({type,size:buf.byteLength,created:Date.now()}));return json({id},201);
 }
 const b=path.match(/^\/_blob\/([a-z0-9]+)$/);
 if(b&&(m==='GET'||m==='HEAD')){
  if(!blobId(b[1]))return err('찾을 수 없습니다.','not_found',404);const meta=await bucket.get('blobmeta/'+b[1]);if(!meta)return err('찾을 수 없습니다.','not_found',404);const info=await meta.json();
  const o=await bucket.get('blobs/'+b[1],{range:request.headers});if(!o)return err('찾을 수 없습니다.','not_found',404);
  const inline=INLINE.test(info.type);
  const headers=new Headers({'Content-Type':inline?info.type:'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'",'Cache-Control':'public, max-age=86400, immutable','Accept-Ranges':'bytes','Content-Disposition':inline?'inline':'attachment'});
  let status=200;if(o.range){status=206;headers.set('Content-Range',`bytes ${o.range.offset}-${o.range.offset+o.range.length-1}/${o.size}`);headers.set('Content-Length',String(o.range.length));}
  return new Response(m==='HEAD'?null:o.body,{status,headers});
 }
 if(path==='/api/db/lab/dimensions'){
  if(m==='GET'){const o=await bucket.get('db/lab/dimensions');return json({data:o?await o.json():null});}
  if(m==='PUT'){let d;try{d=await request.json();}catch{return err('잘못된 요청입니다.','bad_request',400);}const v={reach:Number(d&&d.reach),height:Number(d&&d.height),od:Number(d&&d.od)};
   if(!(v.reach>=40&&v.reach<=400&&v.height>=60&&v.height<=500&&v.od>=6&&v.od<=60))return err('허용 범위: 출수구 40–400, 전체 높이 60–500, 외경 6–60 (mm)','bad_request',400);
   v.updatedAt=Date.now();await bucket.put('db/lab/dimensions',JSON.stringify(v));return json({data:v});}
 }
 const c=path.match(/^\/api\/db\/([a-z]+)(?:\/([a-z0-9]+))?$/);const spec=c&&COLS[c[1]];
 if(!spec)return err('찾을 수 없습니다.','not_found',404);
 const name=c[1],id=c[2],key='db/'+name;
 if(!id&&m==='GET'){
  const {obj,data}=await readCol(bucket,name);const limit=Math.min(Math.max(Number(url.searchParams.get('limit'))||spec.max,1),spec.max);
  const tag='"'+(obj?obj.etag:'empty')+'-'+limit+'"';if(request.headers.get('If-None-Match')===tag)return new Response(null,{status:304,headers:{ETag:tag,'Cache-Control':'no-cache'}});
  return Response.json(data.items.slice(0,limit).map(({deleteKey,...x})=>x),{headers:{ETag:tag,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 }
 if(!id&&m==='POST'){
  let d;try{d=await request.json();}catch{return err('잘못된 요청입니다.','bad_request',400);}
  const item=d&&typeof d==='object'?spec.clean(d):null;if(!item)return err('입력값을 확인해 주세요.','bad_request',400);
  for(const f of ['assetId','imageId'])if(item[f]&&!await bucket.get('blobmeta/'+item[f]))return err('첨부 파일을 찾을 수 없어요. 다시 올려 주세요.','bad_request',400);
  const doc={id:newId('d'),...item,createdAt:Date.now()};
  const out=await mutate(bucket,key,data=>{const items=(data&&data.items)||[];if(items.length>=spec.max){if(spec.full==='reject')return {error:err('저장 공간이 가득 찼어요. 오래된 항목을 정리해 주세요.','quota_or_state',507)};items.length=spec.max-1;}return {data:{items:[doc,...items]}};});
  if(out.error)return out.error;return json({id:doc.id},201);
 }
 if(id&&m==='DELETE'){
  if(!docId(id))return err('찾을 수 없습니다.','not_found',404);let removed=null;
  const out=await mutate(bucket,key,data=>{const items=(data&&data.items)||[];const it=items.find(x=>x.id===id);if(!it)return {error:err('찾을 수 없습니다.','not_found',404)};removed=it;return {data:{items:items.filter(x=>x!==it)}};});
  if(out.error)return out.error;await removeBlobs(bucket,[removed.assetId,removed.imageId]);return json({ok:true});
 }
 return err('지원하지 않는 요청입니다.','bad_request',405);
}

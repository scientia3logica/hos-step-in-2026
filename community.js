/* Standalone storage client for the site (no Claude login).
   app.js was written for the Claude artifact runtime and calls window.claude.use('db'|'assets'|'downloads'|'user').
   This file provides the same small surface on top of this site's own Worker API (/api/db, /api/blob, /_blob). */
(function(){
'use strict';
var KEYS_LS='hos.deleteKeys';
var POLL_MS=5000;
function keys(){try{return JSON.parse(localStorage.getItem(KEYS_LS)||'{}')||{}}catch(e){return {}}}
function saveKey(path,key){try{var k=keys();k[path]=key;localStorage.setItem(KEYS_LS,JSON.stringify(k))}catch(e){}}
function dropKey(path){try{var k=keys();delete k[path];localStorage.setItem(KEYS_LS,JSON.stringify(k))}catch(e){}}
function fail(res,body){var e=new Error((body&&body.error)||('HTTP '+res.status));e.code=(body&&body.code)||('http_'+res.status);throw e}
function call(method,url,body,headers){
  var opt={method:method,headers:headers||{},cache:'no-cache'};
  if(body!==undefined){if(body instanceof Blob){opt.body=body}else{opt.body=JSON.stringify(body);opt.headers['Content-Type']='application/json'}}
  return fetch(url,opt).then(function(res){
    return res.json().catch(function(){return null}).then(function(data){if(!res.ok)fail(res,data);return data});
  },function(){var e=new Error('network');e.code='network';throw e});
}
function snapOf(list){return {docs:list.map(function(o){var id=o.id;return {id:id,data:function(){var c=Object.assign({},o);delete c.id;return c}}})}}
/* Poll a getter while the tab is visible; deliver only when the result changes. */
function poll(get,next,error){
  var stop=false,sig=null,timer=null;
  function tick(){
    if(stop)return;
    if(document.hidden){timer=setTimeout(tick,POLL_MS);return}
    get().then(function(v){if(stop)return;var s=JSON.stringify(v.raw);if(s!==sig){sig=s;next(v.snap)}},function(er){if(!stop&&error)error(er)})
      .then(function(){if(!stop)timer=setTimeout(tick,POLL_MS)});
  }
  tick();
  return function(){stop=true;clearTimeout(timer)};
}
function query(col,lim){
  var q={
    orderBy:function(){return q},
    limit:function(n){return query(col,n)},
    get:function(){return call('GET','/api/db/'+col+(lim?'?limit='+lim:'')).then(snapOf)},
    onSnapshot:function(next,error){return poll(function(){return call('GET','/api/db/'+col+(lim?'?limit='+lim:'')).then(function(l){return {raw:l,snap:snapOf(l)}})},next,error)},
    add:function(data){return call('POST','/api/db/'+col,data).then(function(r){saveKey(col+'/'+r.id,r.deleteKey);return {id:r.id}})}
  };
  return q;
}
function doc(path){
  var url='/api/db/'+path.split('/').map(encodeURIComponent).join('/');
  function docSnap(d){return {exists:!!d,data:function(){return d}}}
  return {
    get:function(){return call('GET',url).then(function(r){return docSnap(r&&r.data)})},
    set:function(data){return call('PUT',url,data)},
    delete:function(){var k=keys()[path];return call('DELETE',url,undefined,k?{'X-Delete-Key':k}:{}).then(function(r){dropKey(path);return r})},
    onSnapshot:function(next,error){return poll(function(){return call('GET',url).then(function(r){var d=r&&r.data||null;return {raw:d,snap:docSnap(d)}})},next,error)}
  };
}
var db={collection:function(c){return query(c,0)},doc:doc};
var assets={
  upload:function(blob){
    if(blob.size>20*1048576){var e=new Error('too large');e.code='too_large';return Promise.reject(e)}
    return call('POST','/api/blob',blob,{'Content-Type':blob.type||'application/octet-stream'}).then(function(r){return {id:r.id,url:'/_blob/'+r.id}});
  },
  /* Files are removed by the server together with the model or log that uses them. */
  delete:function(){return Promise.resolve()}
};
var downloads={
  save:function(o){
    var blob=o.data instanceof Blob?o.data:new Blob([o.data],{type:'text/plain;charset=utf-8'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=o.filename||'download';document.body.append(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},2000);
    return Promise.resolve({ok:true});
  }
};
var user={can:function(){return Promise.resolve(true)},isOwner:function(){return Promise.resolve(false)},canEdit:function(){return Promise.resolve(false)}};
var health=null;
function online(){if(!health)health=call('GET','/api/health').then(function(){return true},function(){return false});return health}
window.claude={use:function(name){
  if(name==='downloads')return Promise.resolve(downloads);
  return online().then(function(ok){
    if(!ok)return null;
    return {db:db,assets:assets,user:user}[name]||null;
  });
}};
})();

(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s)};
function h(tag,attrs){
  var e=document.createElement(tag);attrs=attrs||{};
  Object.keys(attrs).forEach(function(k){var v=attrs[k];
    if(k==='class')e.className=v;else if(k==='text')e.textContent=v;
    else if(k.indexOf('on')===0)e.addEventListener(k.slice(2),v);else e.setAttribute(k,v);});
  for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null)continue;
    if(Array.isArray(c))c.forEach(function(x){if(x!=null)e.append(x.nodeType?x:document.createTextNode(x))});
    else e.append(c.nodeType?c:document.createTextNode(c));}
  return e;
}
function lsGet(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function num(id){return parseFloat($(id).value)}
function fmtTime(ts){try{return new Date(ts).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}}
function fmtSize(b){return b>1048576?(b/1048576).toFixed(1)+'MB':Math.max(1,Math.round(b/1024))+'KB'}
function useCap(n){try{return window.claude&&claude.use?claude.use(n).catch(function(){return null}):Promise.resolve(null)}catch(e){return Promise.resolve(null)}}
function setNote(el,text,warn){el.textContent=text||'';el.classList.toggle('warn',!!warn)}
var TWO_STEP={};
function twoStep(btn,label,action){
  var armed=false,t=null,orig=btn.textContent;
  btn.addEventListener('click',function(){
    if(!armed){armed=true;btn.textContent=label;t=setTimeout(function(){armed=false;btn.textContent=orig},4000);return}
    clearTimeout(t);armed=false;btn.textContent=orig;action();
  });
}

/* ================= shared layer ================= */
var S={db:null,assets:null,dl:null,mode:'local',canWrite:true,ready:false,admin:false};
var CONF={};
var REF={};
/* Live list with three safety nets: realtime snapshot, an immediate read, and polling if the stream is silent. */
function liveQuery(q,apply,errEl){
  var last=0,shown=false,sig='';
  function take(snap){last=Date.now();var list=snap.docs.map(function(d){var o=d.data();o.id=d.id;return o});var sg=JSON.stringify(list);if(sg!==sig){sig=sg;apply(list)}if(shown){setNote(errEl,'');shown=false}}
  function fail(er){setNote(errEl,'목록을 불러오지 못했어요'+(er&&er.code?' ('+er.code+')':'')+'. 잠시 후 다시 시도해요.',true);shown=true}
  function refresh(){return q.get().then(take).catch(fail)}
  try{q.onSnapshot(take,fail)}catch(e){fail(e)}
  refresh();
  setInterval(function(){if(document.hidden)return;if(Date.now()-last>12000)refresh()},6000);
  return refresh;
}
/* Delete control that keeps its "really delete?" state across list re-renders. */
function delControl(key,onDelete,rerender,cls){
  var base=cls||'linkbtn';
  if(CONF[key]){
    var yes=h('button',{class:base,type:'button',style:'color:var(--danger);font-weight:700',text:'정말 삭제'});
    var no=h('button',{class:base,type:'button',text:'취소'});
    yes.addEventListener('click',function(){delete CONF[key];onDelete()});
    no.addEventListener('click',function(){delete CONF[key];rerender()});
    return h('span',{style:'display:inline-flex;gap:8px;align-items:center'},yes,no);
  }
  var b=h('button',{class:base,type:'button',text:'삭제'});
  b.addEventListener('click',function(){CONF[key]=true;rerender()});
  return b;
}
/* Standalone site: every visitor can delete messages and experiment logs (models already work this way). */
var ANYONE_DELETES=true;
function errCode(er){return er&&er.code?' ('+er.code+')':''}
var MINE=lsGet('hos.mine',{msgs:[],nick:'',author:''});MINE.logs=MINE.logs||[];
function saveMine(){lsSet('hos.mine',MINE)}

function setShareStatus(){
  var el=$('#shareStatus'),sp=el.querySelector('span');el.classList.remove('on','off');
  if(!S.ready){sp.textContent='공동 저장 연결을 확인하는 중…';return}
  if(S.mode==='shared'&&S.canWrite){el.classList.add('on');sp.textContent='공동 저장 연결됨 · 다른 참여자의 글과 모델이 실시간으로 보입니다.'}
  else if(S.mode==='shared'){el.classList.add('off');sp.textContent='읽기 전용 · 공동 저장된 내용을 볼 수만 있습니다. 쓰기 권한이 필요해요.'}
  else{el.classList.add('off');sp.textContent='이 보기에서는 공동 저장을 쓸 수 없어 글·치수가 이 브라우저에만 저장돼요. 모델 파일은 새로고침하면 사라집니다.'}
}
function lockWrites(){
  var ro=(S.mode==='shared'&&!S.canWrite);
  ['#uBtn','#cSend','#dSave','#lgBtn'].forEach(function(s){$(s).disabled=ro});
  if(ro){setNote($('#uNote'),'쓰기 권한이 없어요.',true)}
}

/* ================= dimensions ================= */
var DIMS={reach:80,height:110,od:20};
var dimsLocal=lsGet('hos.dims',null);
if(dimsLocal)DIMS=dimsLocal;
function fillDims(){$('#dReach').value=DIMS.reach;$('#dH').value=DIMS.height;$('#dOD').value=DIMS.od}
fillDims();
function applyDims(d){
  DIMS={reach:d.reach,height:d.height,od:d.od};fillDims();
  if(sim.started){buildFaucet();placeAttachment()}
}
$('#dSave').addEventListener('click',function(){
  var d={reach:num('#dReach'),height:num('#dH'),od:num('#dOD')};
  var ok=d.reach>=40&&d.reach<=400&&d.height>=60&&d.height<=500&&d.od>=6&&d.od<=60;
  if(!ok){setNote($('#dNote'),'허용 범위: 출수구 40–400, 전체 높이 60–500, 외경 6–60 (mm)',true);return}
  var btn=$('#dSave');btn.disabled=true;
  var done=function(msg,warn){btn.disabled=false;setNote($('#dNote'),msg,warn)};
  if(S.mode==='shared'&&S.db){
    S.db.doc('lab/dimensions').set({reach:d.reach,height:d.height,od:d.od,updatedAt:Date.now()})
      .then(function(){applyDims(d);done('공동 치수를 저장했어요.')})
      .catch(function(){done('저장하지 못했어요. 권한이나 연결을 확인해 주세요.',true)});
  }else{lsSet('hos.dims',d);applyDims(d);done('이 브라우저에 저장했어요.')}
});

/* ================= messages ================= */
var CH='talk',CH_LABEL={talk:'멤버 소통',idea:'산출물 제안',result:'산출물 결과'};
var MSGS=[];
function renderFeed(){
  var feed=$('#feed');feed.textContent='';
  $('#feedTitle').textContent=CH_LABEL[CH];
  var list=MSGS.filter(function(m){return (m.ch||'talk')===CH}).slice(0,100);
  if(!list.length){feed.append(h('div',{class:'empty',text:'아직 글이 없어요. 첫 메시지를 남겨 보세요.'}));return}
  list.forEach(function(m){
    var mine=ANYONE_DELETES||MINE.msgs.indexOf(m.id)>-1||S.admin;
    var head=h('header',{},h('b',{text:m.nick||'익명'}),h('span',{text:fmtTime(m.createdAt)}));
    if(mine){var ctl=delControl('msg:'+m.id,function(){deleteMsg(m.id)},renderFeed);ctl.classList.add('x');head.append(ctl)}
    feed.append(h('div',{class:'bubble'},head,h('p',{text:m.text||''})));
  });
}
function deleteMsg(id){
  MINE.msgs=MINE.msgs.filter(function(x){return x!==id});saveMine();
  if(S.mode==='shared'&&S.db){MSGS=MSGS.filter(function(m){return m.id!==id});renderFeed();S.db.doc('messages/'+id).delete().then(function(){REF.msgs&&REF.msgs()}).catch(function(er){setNote($('#cNote'),'삭제하지 못했어요'+errCode(er)+'. 권한을 확인해 주세요.',true);REF.msgs&&REF.msgs()})}
  else{MSGS=MSGS.filter(function(m){return m.id!==id});lsSet('hos.msgs',MSGS);renderFeed()}
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click',function(){
    CH=t.dataset.ch;document.querySelectorAll('.tab').forEach(function(x){x.setAttribute('aria-selected',x===t?'true':'false')});
    var isLog=CH==='log';$('#msgPane').hidden=isLog;$('#logPane').hidden=!isLog;
    if(!isLog)renderFeed();
  });
});
$('#cNick').value=MINE.nick||'';
$('#cSend').addEventListener('click',function(){
  var nick=$('#cNick').value.trim(),text=$('#cText').value.trim();
  if(!nick){setNote($('#cNote'),'닉네임을 입력해 주세요.',true);return}
  if(!text){setNote($('#cNote'),'메시지를 입력해 주세요.',true);return}
  MINE.nick=nick;saveMine();
  var btn=$('#cSend');btn.disabled=true;
  var msg={ch:CH,nick:nick,text:text,createdAt:Date.now()};
  var fin=function(m,w){btn.disabled=false;setNote($('#cNote'),m,w)};
  if(S.mode==='shared'&&S.db){
    S.db.collection('messages').add(msg).then(function(ref){MINE.msgs.push(ref.id);saveMine();$('#cText').value='';fin('보냈어요.');REF.msgs&&REF.msgs()})
      .catch(function(){fin('보내지 못했어요. 잠시 후 다시 시도해 주세요.',true)});
  }else{
    msg.id='l'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    MSGS.unshift(msg);MSGS=MSGS.slice(0,100);lsSet('hos.msgs',MSGS);MINE.msgs.push(msg.id);saveMine();
    $('#cText').value='';renderFeed();fin('보냈어요. (이 브라우저에만 저장)');
  }
});
function startMessages(){
  if(S.mode==='shared'&&S.db){
    REF.msgs=liveQuery(S.db.collection('messages').orderBy('createdAt','desc').limit(100),function(list){MSGS=list;renderFeed()},$('#cNote'));
  }else{MSGS=lsGet('hos.msgs',[]);renderFeed()}
}

/* ================= shared models ================= */
var MODELS=[];
$('#uAuthor').value=MINE.author||'';
var ALLOWED=/\.(stl|obj|ply|off|glb|gltf|step|stp|html?|txt|md|csv|json|svg|pdf|png|jpe?g|gif|webp|avif|bmp|mp4|webm|mov|m4v)$/i;
var TEXT_EXT=/^(html?|txt|md|csv|json|obj|off|gltf|ply|step|stp|svg)$/,MODEL_EXT=/^(stl|obj|ply|off|glb|gltf|step|stp)$/,WRAP_EXT=/^(html?|obj|stl|ply|off|glb|gltf|step|stp)$/,SIM_EXT=/^(stl|obj|ply|off|glb|gltf|html?)$/;
function uploadFile(as,f){
  var e=(/\.([a-z0-9]+)$/i.exec(f.name)||[])[1];e=e?e.toLowerCase():'';
  var wrap=function(){return as.upload(new Blob([f],{type:'text/plain'})).then(function(r){r.wrapped=true;return r})};
  if(/^html?$/.test(e))return wrap();
  return as.upload(f).catch(function(err){
    if(err&&err.code==='unsupported_type'&&WRAP_EXT.test(e))return wrap();
    throw err;
  });
}
function getBlob(m,url){
  if(m.file)return Promise.resolve(m.file);
  return fetch(url).then(function(r){if(!r.ok)throw 0;return r.blob()});
}
function ext(n){var m=/\.([a-z0-9]+)$/i.exec(n||'');return m?m[1].toLowerCase():''}
function renderModels(){
  var box=$('#models');box.textContent='';
  $('#mCount').textContent=MODELS.length?MODELS.length+'개':'';
  if(!MODELS.length){box.append(h('div',{class:'empty',style:'grid-column:1/-1',text:'아직 올라온 모델이 없어요. 첫 모델을 공유해 보세요.'}));return}
  MODELS.forEach(function(m){
    var e=ext(m.fileName),url=m.url||(m.assetId?'/_blob/'+m.assetId:'');
    var pv=h('div',{class:'pv'});
    if((m.contentType||'').indexOf('image/')===0&&url){pv.append(h('img',{src:url,alt:m.name||'공유 이미지',loading:'lazy'}))}
    else if((m.contentType||'').indexOf('video/')===0&&url){pv.append(h('video',{src:url,controls:'',preload:'metadata'}))}
    else pv.textContent=(e||'파일').toUpperCase()+(MODEL_EXT.test(e)?' 모델':' 파일');
    var acts=h('div',{class:'acts'}),pre=null;
    if(SIM_EXT.test(e)&&url){
      var lb=h('button',{class:'btn sm water',type:'button',text:'시뮬레이터에 불러오기'});
      lb.addEventListener('click',function(){loadSharedModel(m,url,e)});acts.append(lb);
    }
    if(TEXT_EXT.test(e)&&url&&(m.size||0)>0){
      pre=h('pre',{class:'src',hidden:''});
      var vb=h('button',{class:'btn sm',type:'button',text:'내용 보기'});
      vb.addEventListener('click',function(){
        if(!pre.hidden){pre.hidden=true;vb.textContent='내용 보기';return}
        pre.hidden=false;vb.textContent='내용 접기';
        if(pre.dataset.ok)return;
        pre.textContent='불러오는 중…';
        getBlob(m,url).then(function(b){return b.slice(0,6000).text()}).then(function(t){
          pre.textContent=t+((m.size||0)>6000?'\n…(이하 생략)':'');pre.dataset.ok='1';
        }).catch(function(){pre.textContent='내용을 불러오지 못했어요.'});
      });
      acts.append(vb);
    }
    if(url){
      var dbtn=h('button',{class:'btn sm',type:'button',text:'내려받기'});
      dbtn.addEventListener('click',function(){
        if(!S.dl){setNote($('#uNote'),'이 보기에서는 파일 저장을 쓸 수 없어요.',true);return}
        getBlob(m,url).then(function(b){return S.dl.save({filename:m.fileName||'download',data:b})})
          .then(function(){setNote($('#uNote'),'저장했어요.')})
          .catch(function(er){setNote($('#uNote'),er&&er.code==='declined'?'저장을 취소했어요.':'내려받지 못했어요.',true)});
      });
      acts.append(dbtn);
    }
    if(!(S.mode==='shared'&&!S.canWrite))acts.append(delControl('model:'+m.id,function(){deleteModel(m)},renderModels,'btn sm danger'));
    box.append(h('div',{class:'card'},pv,h('h4',{text:m.name||m.fileName||'이름 없음'}),
      h('div',{class:'meta',text:(m.author||'익명')+' · '+fmtTime(m.createdAt)+' · '+fmtSize(m.size||0)}),
      m.desc?h('p',{class:'note',text:m.desc}):null,acts,pre));
  });
}
function deleteModel(m){
  if(S.mode==='shared'&&S.db){
    MODELS=MODELS.filter(function(x){return x.id!==m.id});renderModels();
    S.db.doc('models/'+m.id).delete().then(function(){
      if(m.assetId&&S.assets){S.assets.delete(m.assetId).catch(function(){})}
      REF.models&&REF.models();
    }).catch(function(er){setNote($('#uNote'),'삭제하지 못했어요'+errCode(er)+'. 권한을 확인해 주세요.',true);REF.models&&REF.models()});
  }else{MODELS=MODELS.filter(function(x){return x.id!==m.id});if(m.url)try{URL.revokeObjectURL(m.url)}catch(e){};renderModels()}
}
$('#uBtn').addEventListener('click',function(){
  var author=$('#uAuthor').value.trim(),name=$('#uName').value.trim(),desc=$('#uDesc').value.trim(),f=$('#uFile').files[0];
  var note=$('#uNote');
  if(!author){setNote(note,'작성자를 입력해 주세요.',true);return}
  if(!f){setNote(note,'올릴 파일을 선택해 주세요.',true);return}
  if(f.size>20*1048576){setNote(note,'파일이 20MB를 넘어요. 이 공간의 업로드 최대치는 20MB예요. 더 작게 줄여 주세요.',true);return}
  if(!ALLOWED.test(f.name)&&!/^(image|video)\//.test(f.type||'')){setNote(note,'지원하지 않는 형식이에요. STL, OBJ, PLY, OFF, GLB, GLTF, STEP, HTML, PDF, TXT, MD, CSV, JSON, 이미지, 영상만 올릴 수 있어요.',true);return}
  MINE.author=author;saveMine();
  var btn=$('#uBtn');btn.disabled=true;setNote(note,'올리는 중…');
  var fin=function(m,w){btn.disabled=false;setNote(note,m,w)};
  var base={author:author,name:name||f.name,desc:desc,fileName:f.name,size:f.size,contentType:f.type||'',createdAt:Date.now()};
  var reset=function(){$('#uName').value='';$('#uDesc').value='';$('#uFile').value=''};
  if(S.mode==='shared'&&S.db){
    useCap('assets').then(function(as){
      if(!as){fin('이 보기에서는 파일을 올릴 권한이 없어요.',true);return}
      S.assets=as;
      return uploadFile(as,f).then(function(r){
        base.assetId=r.id;base.wrapped=!!r.wrapped;
        return S.db.collection('models').add(base).then(function(){reset();fin('공유했어요.');REF.models&&REF.models()});
      });
    }).catch(function(e){
      var c=e&&e.code,msg={unsupported_type:'서버가 이 파일 형식을 받지 않아요. 다른 형식으로 저장해 올려 주세요.',too_large:'파일이 너무 커요. 20MB 이하로 줄여 주세요.',quota_or_state:'저장 공간이 가득 찼거나 지금은 올릴 수 없어요.',rate_limited:'너무 자주 올리고 있어요. 잠시 후 다시 시도해 주세요.'};
      fin(msg[c]||('올리지 못했어요'+(c?' ('+c+')':'')+'. 파일 형식이나 용량을 확인해 주세요.'),true);
    });
  }else{
    base.id='l'+Date.now().toString(36);base.url=URL.createObjectURL(f);base.file=f;
    MODELS.unshift(base);renderModels();reset();fin('공유했어요. (이 브라우저에서만 보입니다)');
  }
});
function startModels(){
  if(S.mode==='shared'&&S.db){
    REF.models=liveQuery(S.db.collection('models').orderBy('createdAt','desc').limit(60),function(list){MODELS=list;renderModels()},$('#uNote'));
  }else renderModels();
}
function startDims(){
  if(S.mode==='shared'&&S.db){
    S.db.doc('lab/dimensions').onSnapshot(function(s){
      if(s.exists){var d=s.data();if(d&&d.reach&&d.height&&d.od)applyDims(d)}
    },function(){});
  }
}

/* ================= impact calculator ================= */
function calcImpact(){
  var a=num('#iA'),b=num('#iB'),s=num('#iS'),n=num('#iN');
  if([a,b,s,n].some(function(x){return isNaN(x)||x<0})){$('#iOut').textContent='–';$('#iPct').textContent='0 이상의 숫자를 입력해 주세요.';return}
  var saved=Math.max(0,a-b)*s/60*n,pct=a>0?Math.max(0,(a-b)/a*100):0;
  $('#iOut').textContent=saved.toFixed(1);
  $('#iPct').textContent=b>a?'개선 유량이 기존보다 커서 절수량은 0으로 표시합니다.':'기존 대비 '+pct.toFixed(1)+'% 절감 · 입력한 예시 조건 기준';
}
['#iA','#iB','#iS','#iN'].forEach(function(s){$(s).addEventListener('input',calcImpact)});
calcImpact();

/* ================= experiment log ================= */
var LOG=lsGet('hos.log',[]);
function saveLog(){lsSet('hos.log',LOG)}
var COLS=['a','b','c','d'];
function renderLog(){
  var body=$('#lBody');body.textContent='';
  $('#lEmpty').style.display=LOG.length?'none':'';
  LOG.forEach(function(r,i){
    var tr=h('tr',{},h('td',{text:String(i+1)}));
    COLS.forEach(function(c){
      var inp=h('input',{type:'number',min:'0',step:'any',inputmode:'decimal','aria-label':(i+1)+'회차 '+c,value:r[c]==null?'':String(r[c])});
      inp.addEventListener('input',function(){r[c]=inp.value===''?null:parseFloat(inp.value);saveLog();renderSum()});
      tr.append(h('td',{},inp));
    });
    var del=h('button',{class:'linkbtn',type:'button',text:'삭제'});
    del.addEventListener('click',function(){LOG.splice(i,1);saveLog();renderLog()});
    tr.append(h('td',{},del));body.append(tr);
  });
  renderSum();
}
function avg(k){var v=LOG.map(function(r){return r[k]}).filter(function(x){return typeof x==='number'&&!isNaN(x)});return v.length?v.reduce(function(a,b){return a+b},0)/v.length:null}
function renderSum(){
  var box=$('#lSum');box.textContent='';
  if(!LOG.length)return;
  function card(label,o,n){
    var t='–';
    if(o!=null&&n!=null&&o>0)t=((o-n)/o*100).toFixed(1)+'%';
    box.append(h('div',{class:'res'},h('span',{text:label}),h('b',{text:t}),
      h('small',{text:o==null||n==null?'기존·개선 값을 모두 입력하면 계산돼요':'평균 '+o.toFixed(1)+' → '+n.toFixed(1)})));
  }
  card('물 사용량 감소율',avg('a'),avg('b'));
  card('젖은 부피 감소율',avg('c'),avg('d'));
}
$('#lAdd').addEventListener('click',function(){LOG.push({a:null,b:null,c:null,d:null});saveLog();renderLog()});
$('#lCsv').addEventListener('click',function(){
  var note=$('#lNote');
  if(!LOG.length){setNote(note,'내려받을 측정값이 아직 없어요.',true);return}
  var rows=[['회차','기존 물 사용량(mL)','개선 물 사용량(mL)','기존 젖은 부피(L)','개선 젖은 부피(L)']];
  LOG.forEach(function(r,i){rows.push([i+1].concat(COLS.map(function(c){return r[c]==null?'':r[c]})))});
  var csv='\ufeff'+rows.map(function(r){return r.join(',')}).join('\r\n');
  if(!S.dl){setNote(note,'이 보기에서는 파일 저장을 쓸 수 없어요. 표를 복사해 사용해 주세요.',true);return}
  S.dl.save({filename:'step-in-2026-experiment.csv',data:csv})
    .then(function(){setNote(note,'CSV를 저장했어요.')})
    .catch(function(e){setNote(note,e&&e.code==='declined'?'저장을 취소했어요.':'저장하지 못했어요.',true)});
});
renderLog();

/* ================= flow calc ================= */
var FLOW={q:0,d:8,k:1};
function measured(v,t){var a=num(v),b=num(t);return(a>0&&b>0)?a/1000/(b/60):null}
function updateFlow(){
  var q0=measured('#qV','#qT'),dO=num('#dOld'),dN=num('#dNew'),q1=measured('#qV2','#qT2');
  var cells=['#rO','#rQ','#rP','#rS'],note=$('#simNote');
  var clear=function(m){cells.forEach(function(c){$(c).textContent='–'});setNote(note,m,true)};
  if(!q0){clear('기존 유량: 받은 물의 양과 걸린 시간을 0보다 큰 숫자로 입력해 주세요.');return}
  var q,how;
  if(q1){q=q1;how='직접 측정한 값'}
  else{
    if(!(dO>0&&dN>0)){clear('출구 지름을 0보다 큰 숫자로 입력하거나, 개선품 측정값(③)을 입력해 주세요.');return}
    q=q0*Math.pow(dN/dO,2);how='출구 단면적 비율로 추정한 값'
  }
  FLOW.q=q;FLOW.d=dN>0?dN:8;
  $('#rO').textContent=q0.toFixed(2);$('#rQ').textContent=q.toFixed(2);
  $('#rP').textContent=((q0-q)/q0*100).toFixed(1);$('#rS').textContent=(q0-q).toFixed(2);
  setNote(note,'개선 유량은 '+how+'이에요.'+(q>q0?' 개선 유량이 기존보다 커서 절수율이 음수예요.':''),q>q0);
}
['#qV','#qT','#dOld','#dNew','#qV2','#qT2'].forEach(function(x){$(x).addEventListener('input',updateFlow)});
updateFlow();

/* ================= 3D simulation ================= */
var THREE=null;
var sim={started:false,running:true,visible:true,last:0,acc:0,tris:null,grid:null,srcPos:null,group:null,att:null,pts:null,
  orbit:{th:.65,ph:1.2,r:520,tx:0,ty:60,tz:90}};
var MAXP=5200,P={tb:null,a0:null,pos:new Float32Array(MAXP*3),vel:new Float32Array(MAXP*3),age:new Float32Array(MAXP),alive:new Uint8Array(MAXP),kind:new Uint8Array(MAXP),size:new Float32Array(MAXP),alpha:new Float32Array(MAXP),next:0};
P.tb=new Float32Array(MAXP);P.a0=new Float32Array(MAXP);
function setMsg(t){var m=$('#viewerMsg');m.innerHTML='';if(t){m.append.apply(m,String(t).split('\n').map(function(x,i){return i?[h('br'),x]:[x]}).reduce(function(a,b){return a.concat(b)},[]))}m.style.display=t?'grid':'none'}
function loadThree(){
  return new Promise(function(res,rej){
    if(window.THREE)return res(window.THREE);
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload=function(){window.THREE?res(window.THREE):rej(new Error('3D 엔진을 읽지 못했어요.'))};
    s.onerror=function(){rej(new Error('3D 엔진을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'))};
    document.head.append(s);
  });
}
function enableSimControls(on){
  ['#pauseBtn','#resetBtn','#viewBtn','#exampleBtn','#modelFile'].forEach(function(s){$(s).disabled=!on});
  $('#upLabel').setAttribute('aria-disabled',on?'false':'true');$('#upLabel').style.opacity=on?'1':'.45';
}
enableSimControls(false);
$('#startBtn').addEventListener('click',function(){
  if(sim.started)return;
  var btn=$('#startBtn');btn.disabled=true;setMsg('3D 엔진을 불러오는 중…');
  loadThree().then(function(T){
    THREE=T;try{initScene()}catch(e){throw new Error('이 기기에서는 3D 화면을 만들 수 없어요.')}
    sim.started=true;btn.textContent='시뮬레이션 실행 중';enableSimControls(true);setMsg('');LG.started=true;maybeLoginPopup();
    requestAnimationFrame(loop);
  }).catch(function(e){btn.disabled=false;setMsg(e.message)});
});
$('#pauseBtn').addEventListener('click',function(){sim.running=!sim.running;this.textContent=sim.running?'일시정지':'재생'});
$('#resetBtn').addEventListener('click',function(){
  clearAttachment();P.alive.fill(0);if(sim.pud)sim.pud.visible=false;sim.running=true;resetVol();$('#speedRange').value=1;updateSpeed();$('#pauseBtn').textContent='일시정지';
  var o=sim.orbit;o.th=.65;o.ph=1.2;resetCamera();setMsg('');
});
$('#viewBtn').addEventListener('click',function(){var o=sim.orbit;o.th=.65;o.ph=1.2;resetCamera()});
/* Example attachment "FLOW GUARD": funnel -> small orifice tube (flow control) -> ribbed diffuser cone (splash guard) */
function latheTris(prof,seg){
  var t=[],s2,i;
  function pt(r,y,a){return [r*Math.sin(a),y,r*Math.cos(a)]}
  for(s2=0;s2<seg;s2++){
    var a0=2*Math.PI*s2/seg,a1=2*Math.PI*(s2+1)/seg;
    for(i=0;i<prof.length-1;i++){
      var A=pt(prof[i][0],prof[i][1],a0),B=pt(prof[i+1][0],prof[i+1][1],a0),C=pt(prof[i+1][0],prof[i+1][1],a1),D=pt(prof[i][0],prof[i][1],a1);
      t.push.apply(t,A.concat(B,C,A,C,D));
    }
  }
  return t;
}
function shiftTris(t,dx,dz){var o=new Array(t.length),i;for(i=0;i<t.length;i+=3){o[i]=t[i]+dx;o[i+1]=t[i+1];o[i+2]=t[i+2]+dz}return o}
function exampleGeometry(){
  /* "FLOW SOCKET" 34 mm slip-on cap. Top 14 mm is a sleeve that slides over the 20 mm hose connector;
     below it: cosine contraction -> 7-channel honeycomb -> straight settling tube. It ends 20 mm under the outlet,
     so the stream falls free and hands fit underneath. */
  var i,n=10,neck=[[7,-14]];
  for(i=1;i<=n;i++){var u=i/n;neck.push([4.5+2.5*(1+Math.cos(Math.PI*u))/2,-14-10*u])}
  neck.push([4.5,-34]);
  var t=latheTris(neck,56);
  t=t.concat(latheTris([[10.2,0],[10.2,-14]],56));                         /* inner socket wall */
  t=t.concat(latheTris([[12,0],[12,-14],[9,-22],[6.2,-30],[5.6,-34]],56)); /* outer shell, tapers down */
  t=t.concat(latheTris([[12,0],[10.2,0]],56));                             /* top rim */
  t=t.concat(latheTris([[10.2,-14],[7,-14]],56));                          /* seat shoulder */
  var ring=[[0,0]];
  for(i=0;i<6;i++){var a=i*Math.PI/3;ring.push([2.9*Math.sin(a),2.9*Math.cos(a)])}
  ring.forEach(function(c){t=t.concat(shiftTris(latheTris([[1.3,-22],[1.3,-34]],20),c[0],c[1]))});
  return Float32Array.from(t);
}
$('#exampleBtn').addEventListener('click',function(){
  $('#mLen').value=34;$('#mGap').value=-14;
  sim.srcPos=exampleGeometry();sim.srcZup=false;placeAttachment();setMsg('');
  setNote($('#simNote'),'예제 모델(수도꼭지 끝에 끼우는 층류 캡)을 배치했어요. 위쪽 14mm가 연결부에 끼워지고, 물은 출구 20mm 아래에서 나와 손을 씻을 공간이 남아요.');
});
['#mLen','#mGap','#zUp'].forEach(function(s){$(s).addEventListener('change',function(){if(sim.srcPos)placeAttachment()})});

function col(h){return new THREE.Color(h)}
function setPointScale(){var v=new THREE.Vector2();sim.ren.getDrawingBufferSize(v);sim.pu.value=v.y/(2*Math.tan(sim.cam.fov*Math.PI/360))}
function initScene(){
  var T=THREE,el=$('#viewer'),cv=$('#cv'),w=el.clientWidth,hh=el.clientHeight;
  var ren=sim.ren=new T.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
  ren.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  ren.setSize(w,hh,false);
  ren.shadowMap.enabled=true;ren.shadowMap.type=T.PCFSoftShadowMap;
  sim.scene=new T.Scene();
  sim.cam=new T.PerspectiveCamera(38,w/hh,1,6000);
  sim.scene.add(new T.HemisphereLight(0xffffff,0x7d8c92,0.5));
  sim.scene.add(new T.AmbientLight(0xffffff,0.14));
  var dl=new T.DirectionalLight(0xfff4e5,0.8);dl.position.set(200,380,300);dl.target.position.set(0,60,40);sim.scene.add(dl.target);
  dl.castShadow=true;var sms=Math.min(4096,ren.capabilities.maxTextureSize||2048);dl.shadow.mapSize.set(sms,sms);
  var sc=dl.shadow.camera;sc.left=-620;sc.right=620;sc.top=420;sc.bottom=-300;sc.near=100;sc.far=1100;sc.updateProjectionMatrix();
  dl.shadow.bias=-0.0008;dl.shadow.normalBias=0.5;dl.shadow.radius=3;sim.scene.add(dl);
  var dl2=new T.DirectionalLight(0xbfe0f2,0.22);dl2.position.set(-300,150,-100);sim.scene.add(dl2);
  var dl3=new T.DirectionalLight(0xffffff,0.28);dl3.position.set(-120,140,420);sim.scene.add(dl3);
  var geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.BufferAttribute(P.pos,3));
  geo.setAttribute('aSize',new T.BufferAttribute(P.size,1));
  geo.setAttribute('aAlpha',new T.BufferAttribute(P.alpha,1));
  for(var i=0;i<MAXP;i++)P.pos[i*3+1]=-9999;
  sim.pu={value:800};
  sim.pts=new T.Points(geo,new T.ShaderMaterial({uniforms:{uScale:sim.pu},
    vertexShader:'attribute float aSize;attribute float aAlpha;uniform float uScale;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=max(1.0,aSize*uScale/-mv.z);vA=aAlpha;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'varying float vA;void main(){float d=length(gl_PointCoord-vec2(0.5));if(d>0.5)discard;float a=smoothstep(0.5,0.02,d)*vA;gl_FragColor=vec4(0.86,0.94,1.0,a);}',
    transparent:true,depthWrite:false}));
  sim.pts.frustumCulled=false;sim.scene.add(sim.pts);
  var pud=new T.Mesh(new T.CircleGeometry(1,48),new T.MeshBasicMaterial({color:0x9fd2ea,transparent:true,opacity:.3,depthWrite:false}));
  pud.rotation.x=-Math.PI/2;pud.position.y=1;pud.visible=false;pud.scale.set(6,6,1);sim.scene.add(pud);sim.pud=pud;sim.pudT=0;
  buildFaucet();resetCamera();bindOrbit(cv);setPointScale();
  if(window.ResizeObserver){new ResizeObserver(function(){var w=el.clientWidth,h2=el.clientHeight;if(!w||!h2)return;sim.ren.setSize(w,h2,false);sim.cam.aspect=w/h2;sim.cam.updateProjectionMatrix();setPointScale()}).observe(el)}
  if(window.IntersectionObserver){new IntersectionObserver(function(en){sim.visible=en[0].isIntersecting}).observe(el)}
}
function fgeom(){
  var D=DIMS.od,R=DIMS.reach,H=DIMS.height;
  var rb=Math.min(D*1.3,Math.max(D*.6,(R-D)*.5)),connLen=D*1.7,collar=D*.7,vt=D*.35;
  var yo=Math.max(90,H*.9),yw=yo+connLen+collar+vt+rb;
  var rise=Math.max(D*.6,H-(connLen+collar+vt+rb+D/2));
  return {D:D,R:R,H:H,rb:rb,connLen:connLen,collar:collar,vt:vt,yo:yo,yw:yw,rise:rise,
    sp:Math.max(340,D*17),xd:D*11.5,yc:yo+D*.6,rd:D*2.2,Hw:Math.max(430,yw+D*8)};
}
function outlet(){var g=fgeom();return {x:0,y:g.yo,z:g.R}}
/* brushed stainless "matcap": view-space lookup texture, so no environment map / PMREM is needed */
function matcapTex(){
  var N=256,c=document.createElement('canvas');c.width=c.height=N;var x=c.getContext('2d'),i;
  var g=x.createRadialGradient(N*.36,N*.28,N*.02,N*.5,N*.5,N*.52);
  g.addColorStop(0,'#ffffff');g.addColorStop(.16,'#f1f4f5');g.addColorStop(.45,'#b9c1c6');g.addColorStop(.75,'#7d888e');g.addColorStop(.92,'#566066');g.addColorStop(1,'#3d464b');
  x.fillStyle=g;x.fillRect(0,0,N,N);
  var h=x.createLinearGradient(0,0,0,N);
  h.addColorStop(0,'rgba(255,255,255,.55)');h.addColorStop(.18,'rgba(255,255,255,.22)');h.addColorStop(.44,'rgba(255,255,255,0)');h.addColorStop(.54,'rgba(18,26,30,.38)');h.addColorStop(.66,'rgba(18,26,30,0)');h.addColorStop(.86,'rgba(214,228,236,.28)');h.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=h;x.fillRect(0,0,N,N);
  for(i=0;i<1100;i++){var xx=Math.random()*N,yy=Math.random()*N,l=18+Math.random()*70;
    x.strokeStyle='rgba('+(Math.random()<.5?'255,255,255':'0,0,0')+','+(.02+Math.random()*.045)+')';
    x.beginPath();x.moveTo(xx,yy);x.lineTo(xx+(Math.random()-.5)*3,yy+l);x.stroke()}
  return new THREE.CanvasTexture(c);
}
function mats(){
  var T=THREE;
  if(!sim.mc)sim.mc=matcapTex();
  function mc(c){return new T.MeshMatcapMaterial({matcap:sim.mc,color:c})}
  function ph(c,sp,sh){return new T.MeshPhongMaterial({color:c,specular:sp,shininess:sh})}
  return {
    steel:mc(0xffffff),steelS:mc(0xc9d1d5),
    dark:ph(0x15191c,0x4a565d,60),
    blue:ph(0x2866cf,0xa8c0ff,100),
    ivory:ph(0xe9e2cd,0x555555,28),
    ivory2:ph(0xddd4bb,0x444444,24),
    recess:ph(0x24292b,0x222222,10),
    hole:new T.MeshBasicMaterial({color:0x000000,side:T.DoubleSide})
  };
}
function lathe(pts,mat,seg){return new THREE.Mesh(new THREE.LatheGeometry(pts.map(function(p){return new THREE.Vector2(p[0],p[1])}),seg||48),mat)}
/* Wall-mounted stainless lever bibcock modeled on the school wash-stand photos:
   round flange -> horizontal body -> elbow -> hex collar nut -> quick-connect coupler (black band) pointing down,
   swan-shaped lever with blue tip cap on top; the centre unit also gets the thin bullet-tipped S-tube leading to a thick cream disc. */
function makeFaucet(g,M,plain){
  var T=THREE,grp=new T.Group(),D=g.D,R=g.R,rb=g.rb,yw=g.yw,yo=g.yo,i;
  function add(m){grp.add(m);return m}
  // wall flange (profile axis -> +z)
  var fl=add(lathe([[0,0],[D*1.3,0],[D*1.33,D*.05],[D*1.25,D*.16],[D*.95,D*.22],[D*.86,D*.3],[D*.56,D*.34],[0,D*.34]],M.steel,56));
  fl.rotation.x=Math.PI/2;fl.position.set(0,yw,0);
  // horizontal body
  var hl=Math.max(1,R-rb);
  var ht=add(new T.Mesh(new T.CylinderGeometry(D/2,D/2,hl,40),M.steel));ht.rotation.x=Math.PI/2;ht.position.set(0,yw,hl/2);
  // elbow
  var pts=[];
  for(i=0;i<=16;i++){var ph=Math.PI/2*(1-i/16);pts.push(new T.Vector3(0,yw-rb+rb*Math.sin(ph),R-rb+rb*Math.cos(ph)))}
  add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts),48,D/2,32,false),M.steel));
  // short vertical tube + hex collar nut
  var vtm=add(new T.Mesh(new T.CylinderGeometry(D/2,D/2,g.vt+.2,40),M.steel));vtm.position.set(0,yw-rb-g.vt/2,R);
  var nutY=yo+g.connLen+g.collar/2;
  var nut=add(new T.Mesh(new T.CylinderGeometry(D*.7,D*.7,g.collar*.82,6),M.steelS));nut.position.set(0,nutY,R);nut.rotation.y=Math.PI/6;
  [-1,1].forEach(function(k){var w=add(new T.Mesh(new T.CylinderGeometry(D*.6,D*.6,g.collar*.12,40),M.steel));w.position.set(0,nutY+k*g.collar*.46,R)});
  // quick-connect coupler: steel tip, black band, steel sleeve (outer diameter = D at the tip)
  var cl=g.connLen;
  var tip=add(new T.Mesh(new T.CylinderGeometry(D*.5,D*.5,cl*.5,44),M.steel));tip.position.set(0,yo+cl*.25,R);
  var band=add(new T.Mesh(new T.CylinderGeometry(D*.56,D*.56,cl*.15,44),M.dark));band.position.set(0,yo+cl*.575,R);
  var slv=add(new T.Mesh(new T.CylinderGeometry(D*.52,D*.52,cl*.35,44),M.steel));slv.position.set(0,yo+cl*.825,R);
  var grv=add(new T.Mesh(new T.CylinderGeometry(D*.545,D*.545,cl*.05,44),M.steelS));grv.position.set(0,yo+cl*.93,R);
  var hole=add(new T.Mesh(new T.CircleGeometry(D*.34,32),M.hole));hole.rotation.x=Math.PI/2;hole.position.set(0,yo-.05,R);
  // valve housing + dome
  var zs=Math.max(D*1.25,hl*.45),y0=yw+D*.95;
  var hs=add(new T.Mesh(new T.CylinderGeometry(D*.62,D*.66,D*.62,40),M.steel));hs.position.set(0,yw+D*.62,zs);
  var dm=add(new T.Mesh(new T.SphereGeometry(D*.62,36,14,0,Math.PI*2,0,Math.PI/2),M.steel));dm.scale.y=.5;dm.position.set(0,yw+D*.93,zs);
  // swan lever: tapered side profile (z,y) extruded sideways
  var P0=[-.3*D,.1*D],P1=[.1*D,1.3*D],P2=[1.5*D,2.0*D],P3=[3.6*D,1.6*D],N=28,L=[],Rr=[];
  function bz(t,k){var u=1-t;return u*u*u*P0[k]+3*u*u*t*P1[k]+3*u*t*t*P2[k]+t*t*t*P3[k]}
  function db(t,k){var u=1-t;return 3*u*u*(P1[k]-P0[k])+6*u*t*(P2[k]-P1[k])+3*t*t*(P3[k]-P2[k])}
  for(i=0;i<=N;i++){var t=i/N,cx=bz(t,0),cy=bz(t,1),dx=db(t,0),dy=db(t,1),dl=Math.hypot(dx,dy),nx=-dy/dl,ny=dx/dl,hw=D*(.56-.3*t);
    L.push([cx+nx*hw,cy+ny*hw]);Rr.push([cx-nx*hw,cy-ny*hw])}
  var sh=new T.Shape();sh.moveTo(L[0][0],L[0][1]);
  for(i=1;i<=N;i++)sh.lineTo(L[i][0],L[i][1]);
  for(i=N;i>=0;i--)sh.lineTo(Rr[i][0],Rr[i][1]);
  sh.closePath();
  var lev=add(new T.Mesh(new T.ExtrudeGeometry(sh,{depth:D*.3,bevelEnabled:true,bevelThickness:D*.06,bevelSize:D*.06,bevelSegments:3,curveSegments:1}),M.steelS));
  lev.rotation.y=-Math.PI/2;lev.position.set(D*.15,y0,zs);
  var tx=db(1,0),ty=db(1,1),tl=Math.hypot(tx,ty);
  var cap=add(new T.Mesh(new T.SphereGeometry(1,28,18),M.blue));cap.scale.set(D*.24,D*.36,D*.52);
  cap.position.set(0,y0+P3[1]-ty/tl*D*.12,zs+P3[0]-tx/tl*D*.12);cap.rotation.x=-Math.atan2(ty,tx);
  if(!plain){
    var xd=g.xd,yc=g.yc,rd=g.rd,td=D*.65,rt=Math.max(.9,D*.095),ybot=yo+cl*.78,yArch=yc+rd+D*.8,zW=.6;
    // recess ring + thick cream disc
    var rec=add(new T.Mesh(new T.CylinderGeometry(rd*1.22,rd*1.22,1.2,64),M.recess));rec.rotation.x=Math.PI/2;rec.position.set(xd,yc,.6);
    var disc=add(new T.Mesh(new T.CylinderGeometry(rd,rd,td,64),M.ivory));disc.rotation.x=Math.PI/2;disc.position.set(xd,yc,zW+td/2);
    var bt=add(new T.Mesh(new T.CylinderGeometry(rd*.86,rd*.9,td*.22,64),M.ivory2));bt.rotation.x=Math.PI/2;bt.position.set(xd,yc,zW+td+td*.08);
    // bullet-tipped S-tube
    var tp=[[1.45*D,ybot,R],[2.4*D,ybot-.55*D,R*.95],[4.2*D,ybot-.95*D,R*.8],[6.4*D,ybot-.45*D,R*.55],[8.6*D,ybot+.45*D,R*.3],
      [xd-4*D,yArch-D*.1,zW+td*.7],[xd-1.4*D,yArch,zW+td*.55],[xd-.3*D,yArch+.02*D,zW+td*.5],[xd+.35*D,yArch-.45*D,zW+td*.5],[xd+.4*D,yc+rd-.25*D,zW+td*.5]]
      .map(function(a){return new T.Vector3(a[0],a[1],a[2])});
    add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(tp),160,rt,14,false),M.steel));
    var bu=add(new T.Mesh(new T.SphereGeometry(1,20,14),M.steel));bu.scale.set(D*.34,rt*2.3,rt*2.3);bu.position.set(1.28*D,ybot,R);
  }
  grp.traverse(function(o){if(o.isMesh){o.castShadow=true;o.receiveShadow=false}});
  return grp;
}
function drainTex(){
  var c=document.createElement('canvas');c.width=c.height=256;var x=c.getContext('2d');
  x.fillStyle='#aab3b7';x.beginPath();x.arc(128,128,127,0,6.283);x.fill();
  x.fillStyle='#707b80';x.beginPath();x.arc(128,128,112,0,6.283);x.fill();
  x.fillStyle='#10161a';
  [[0,1],[34,6],[66,12],[96,18]].forEach(function(r){for(var k=0;k<r[1];k++){var a=k/r[1]*6.283;x.beginPath();x.arc(128+r[0]*Math.cos(a),128+r[0]*Math.sin(a),8,0,6.283);x.fill()}});
  return new THREE.CanvasTexture(c);
}
function graniteCanvas(base){
  var N=512,c=document.createElement('canvas');c.width=c.height=N;var x=c.getContext('2d');
  x.fillStyle=base;x.fillRect(0,0,N,N);
  for(var i=0;i<46;i++){var cx=Math.random()*N,cy=Math.random()*N,r=30+Math.random()*90,gr=x.createRadialGradient(cx,cy,0,cx,cy,r),v=Math.random()<.5?'255,255,255':'0,0,0';
    gr.addColorStop(0,'rgba('+v+',.07)');gr.addColorStop(1,'rgba('+v+',0)');x.fillStyle=gr;x.fillRect(cx-r,cy-r,2*r,2*r)}
  var id=x.getImageData(0,0,N,N),d=id.data;
  for(var k=0;k<d.length;k+=4){var n=(Math.random()-.5)*46,sp=Math.random();if(sp>.985)n-=70;else if(sp<.012)n+=60;d[k]+=n;d[k+1]+=n;d[k+2]+=n}
  x.putImageData(id,0,0);return c;
}
function granite(base,rep,wet){
  var T=THREE;sim.gran=sim.gran||{};
  if(!sim.gran[base])sim.gran[base]=graniteCanvas(base);
  var c=sim.gran[base],t=new T.CanvasTexture(c),b=new T.CanvasTexture(c);
  [t,b].forEach(function(x){x.wrapS=x.wrapT=T.RepeatWrapping;x.repeat.set(rep[0],rep[1]);x.anisotropy=8});
  return wet?new T.MeshPhongMaterial({map:t,bumpMap:b,bumpScale:.8,specular:0x9fb2bc,shininess:130})
            :new T.MeshPhongMaterial({map:t,bumpMap:b,bumpScale:.8,specular:0x2a2f32,shininess:22});
}
/* big granite wall texture: salt-and-pepper grain, panel joints, brown stain + wet streak under the cream disc */
function wallCanvas(Ww,Hh,g){
  var W=2048,H=Math.max(256,Math.min(1400,Math.round(W*Hh/Ww))),c=document.createElement('canvas');c.width=W;c.height=H;
  var x=c.getContext('2d'),k=W/Ww,i;
  x.fillStyle='#737d82';x.fillRect(0,0,W,H);
  for(i=0;i<80;i++){var cx=Math.random()*W,cy=Math.random()*H,r=40+Math.random()*150,gr=x.createRadialGradient(cx,cy,0,cx,cy,r),v=Math.random()<.5?'255,255,255':'0,0,0';
    gr.addColorStop(0,'rgba('+v+',.06)');gr.addColorStop(1,'rgba('+v+',0)');x.fillStyle=gr;x.fillRect(cx-r,cy-r,2*r,2*r)}
  var id=x.getImageData(0,0,W,H),d=id.data;
  for(var p=0;p<d.length;p+=4){var n=(Math.random()-.5)*26,s=Math.random();if(s>.975)n-=60;else if(s<.025)n+=42;d[p]+=n;d[p+1]+=n;d[p+2]+=n*1.02}
  x.putImageData(id,0,0);
  // panel joints
  var cols=3;
  for(i=1;i<cols;i++){var jx=Math.round(W*i/cols);x.fillStyle='rgba(30,36,38,.85)';x.fillRect(jx-2,0,4,H);x.fillStyle='rgba(255,255,255,.18)';x.fillRect(jx+2,0,1.5,H)}
  // stain below the cream disc (world x=g.xd, y=g.yc-g.rd)
  var sx=(g.xd+Ww/2)*k,sy=(g.Hw-(g.yc-g.rd))*k;
  var st=x.createRadialGradient(sx,sy+30*k,0,sx,sy+30*k,70*k);st.addColorStop(0,'rgba(104,66,38,.38)');st.addColorStop(1,'rgba(104,66,38,0)');x.fillStyle=st;x.fillRect(sx-80*k,sy-40*k,160*k,200*k);
  var sk=x.createLinearGradient(0,sy,0,sy+170*k);sk.addColorStop(0,'rgba(20,26,30,.55)');sk.addColorStop(1,'rgba(20,26,30,0)');
  x.fillStyle=sk;x.fillRect(sx-9*k,sy,18*k,170*k);
  return c;
}
/* voronoi flagstone back wall */
function flagCanvas(){
  var W=1024,H=512,c=document.createElement('canvas');c.width=W;c.height=H;var x=c.getContext('2d');
  var cw=128,ch=102,nx=8,ny=5,seeds=[],i,j;
  for(j=-1;j<=ny;j++)for(i=-1;i<=nx;i++){var s=60+Math.random()*60;seeds.push([(i+.15+Math.random()*.7)*cw,(j+.15+Math.random()*.7)*ch,s+Math.random()*30])}
  var id=x.createImageData(W,H),d=id.data;
  for(var y=0;y<H;y++)for(var xx=0;xx<W;xx++){
    var d1=1e9,d2=1e9,b=0;
    for(var q=0;q<seeds.length;q++){var dx=seeds[q][0]-xx,dy=seeds[q][1]-y,dd=Math.sqrt(dx*dx+dy*dy);if(dd<d1){d2=d1;d1=dd;b=q}else if(dd<d2)d2=dd}
    var e=Math.min(1,(d2-d1)/16),v=seeds[b][2]*(.55+.45*e)+(Math.random()-.5)*12,o=(y*W+xx)*4;
    d[o]=v*1.04+8;d[o+1]=v*1.0+6;d[o+2]=v*.94+2;d[o+3]=255}
  x.putImageData(id,0,0);return c;
}
function buildFaucet(){
  var T=THREE;
  if(sim.group){sim.scene.remove(sim.group);sim.group.traverse(function(o){if(o.geometry)o.geometry.dispose();if(o.material&&o.material.dispose)o.material.dispose()})}
  var g=fgeom(),grp=new T.Group(),R=g.R,sp=g.sp,Hw=g.Hw,Ww=sp*2+900,Hh=Hw+90;
  var core=makeFaucet(g,mats(),false);grp.add(core);sim.core=core;
  [-1,1].forEach(function(k){var n=makeFaucet(g,mats(),true);n.position.x=k*sp;grp.add(n)});
  // granite wall (single big texture with panel joints)
  var wc=wallCanvas(Ww,Hh,g),wt=new T.CanvasTexture(wc),wb=new T.CanvasTexture(wc);
  [wt,wb].forEach(function(t){t.anisotropy=8});
  var wall=new T.Mesh(new T.PlaneGeometry(Ww,Hh),new T.MeshPhongMaterial({map:wt,bumpMap:wb,bumpScale:.35,specular:0x242a2c,shininess:24}));
  wall.position.set(0,Hw-Hh/2,-1);wall.receiveShadow=true;grp.add(wall);
  // polished overhanging cap slab + flagstone wall above it
  var cap=new T.Mesh(new T.BoxGeometry(Ww+40,26,76),granite('#707b80',[Ww/320,.3],true));
  cap.position.set(0,Hw+13,6);cap.castShadow=true;cap.receiveShadow=true;grp.add(cap);
  var fc=new T.CanvasTexture(flagCanvas()),fb=new T.CanvasTexture(flagCanvas());
  var flag=new T.Mesh(new T.PlaneGeometry(Ww,520),new T.MeshPhongMaterial({map:fc,bumpMap:fc,bumpScale:1.2,specular:0x1a1a1a,shininess:8}));
  flag.position.set(0,Hw+26+260,-24);flag.receiveShadow=true;grp.add(flag);
  // basin: slab, raised rim, wet dark floor, round drain
  var bw=sp*2+240,bd=R*2+80;
  var stone=new T.Mesh(new T.BoxGeometry(bw,90,bd),granite('#5f6c72',[bw/220,bd/220],false));
  stone.position.set(0,-45,bd/2-8);stone.receiveShadow=true;grp.add(stone);
  var rimM=granite('#6a767c',[bw/240,.4],true);
  var fr=new T.Mesh(new T.BoxGeometry(bw,24,36),rimM);fr.position.set(0,12,bd-8-18);fr.castShadow=true;fr.receiveShadow=true;grp.add(fr);
  [-1,1].forEach(function(k){var s=new T.Mesh(new T.BoxGeometry(36,24,bd),granite('#6a767c',[.4,bd/240],true));s.position.set(k*(bw/2-18),12,bd/2-8);s.castShadow=true;s.receiveShadow=true;grp.add(s)});
  var cav=new T.Mesh(new T.PlaneGeometry(bw-72,bd-72),granite('#3a444a',[(bw-72)/200,(bd-72)/200],true));
  cav.rotation.x=-Math.PI/2;cav.position.set(0,.4,bd/2-8);cav.receiveShadow=true;grp.add(cav);
  var dr=new T.Mesh(new T.CircleGeometry(36,56),new T.MeshPhongMaterial({map:drainTex(),specular:0xbbbbbb,shininess:80}));
  dr.rotation.x=-Math.PI/2;dr.position.set(0,.7,R);dr.receiveShadow=true;grp.add(dr);
  sim.group=grp;sim.scene.add(grp);
  var o=sim.orbit;o.tx=0;o.ty=(g.yo+g.yw)/2;o.tz=R*.5;
}
function resetCamera(){
  var T=THREE,o=sim.orbit,g=fgeom();
  var box=new T.Box3().setFromObject(sim.core||sim.group.children[0]);
  box.expandByPoint(new T.Vector3(0,0,g.R+10));
  var c=new T.Vector3(),sph=box.getBoundingSphere(new T.Sphere());box.getCenter(c);
  var fy=sim.cam.fov*Math.PI/180,fx=2*Math.atan(Math.tan(fy/2)*sim.cam.aspect);
  o.tx=c.x;o.ty=c.y;o.tz=c.z;o.r=sph.radius/Math.sin(Math.min(fy,fx)/2)*1.05;applyCam();
}
function applyCam(){
  var o=sim.orbit;o.ph=Math.max(.15,Math.min(1.5,o.ph));o.r=Math.max(60,Math.min(1800,o.r));
  sim.cam.position.set(o.tx+o.r*Math.sin(o.ph)*Math.sin(o.th),o.ty+o.r*Math.cos(o.ph),o.tz+o.r*Math.sin(o.ph)*Math.cos(o.th));
  sim.cam.lookAt(o.tx,o.ty,o.tz);
}
function bindOrbit(cv){
  var ptrs={},lastD=0;
  cv.addEventListener('pointerdown',function(e){cv.setPointerCapture(e.pointerId);ptrs[e.pointerId]={x:e.clientX,y:e.clientY};lastD=0});
  cv.addEventListener('pointerup',function(e){delete ptrs[e.pointerId]});
  cv.addEventListener('pointercancel',function(e){delete ptrs[e.pointerId]});
  cv.addEventListener('pointermove',function(e){
    var p=ptrs[e.pointerId];if(!p)return;var ids=Object.keys(ptrs),o=sim.orbit;
    if(ids.length===1){o.th-=(e.clientX-p.x)*.008;o.ph-=(e.clientY-p.y)*.008}
    else if(ids.length===2){
      p.x=e.clientX;p.y=e.clientY;var a=ptrs[ids[0]],b=ptrs[ids[1]],d=Math.hypot(a.x-b.x,a.y-b.y);
      if(lastD)o.r*=lastD/d;lastD=d;applyCam();return;
    }
    p.x=e.clientX;p.y=e.clientY;applyCam();
  });
  cv.addEventListener('wheel',function(e){e.preventDefault();sim.orbit.r*=Math.exp(e.deltaY*.001);applyCam()},{passive:false});
}

/* --- model parsing --- */
var MAXTRI=120000;
function parseSTL(buf){
  if(buf.byteLength>=84){
    var dv=new DataView(buf),n=dv.getUint32(80,true);
    if(buf.byteLength===84+n*50){
      if(n>MAXTRI)throw new Error('삼각형이 '+n.toLocaleString()+'개예요. 12만 개 이하로 단순화해 주세요.');
      var pos=new Float32Array(n*9),o=84;
      for(var i=0;i<n;i++){o+=12;for(var j=0;j<9;j++)pos[i*9+j]=dv.getFloat32(o+j*4,true);o+=38}
      return pos;
    }
  }
  var txt=new TextDecoder().decode(buf),re=/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g,arr=[],m;
  while((m=re.exec(txt))){arr.push(+m[1],+m[2],+m[3]);if(arr.length/9>MAXTRI)throw new Error('삼각형이 너무 많아요. 12만 개 이하로 단순화해 주세요.')}
  if(!arr.length||arr.length%9)throw new Error('STL 파일을 읽을 수 없어요.');
  return Float32Array.from(arr);
}
function parseOBJ(buf){
  var lines=new TextDecoder().decode(buf).split(/\r?\n/),v=[],out=[];
  for(var i=0;i<lines.length;i++){
    var l=lines[i].trim();
    if(l.indexOf('v ')===0){var p=l.split(/\s+/);v.push([+p[1],+p[2],+p[3]])}
    else if(l.indexOf('f ')===0){
      var idx=l.split(/\s+/).slice(1).map(function(t){var k=parseInt(t.split('/')[0],10);return k<0?v.length+k:k-1});
      for(var k=1;k<idx.length-1;k++){
        var tri=[v[idx[0]],v[idx[k]],v[idx[k+1]]];
        if(!tri[0]||!tri[1]||!tri[2])continue;
        out.push(tri[0][0],tri[0][1],tri[0][2],tri[1][0],tri[1][1],tri[1][2],tri[2][0],tri[2][1],tri[2][2]);
        if(out.length/9>MAXTRI)throw new Error('삼각형이 너무 많아요. 12만 개 이하로 단순화해 주세요.');
      }
    }
  }
  if(!out.length)throw new Error('OBJ 파일에서 면을 찾지 못했어요.');
  return Float32Array.from(out);
}

function isBinarySTL(buf){if(buf.byteLength<84)return false;var n=new DataView(buf).getUint32(80,true);return buf.byteLength===84+n*50}
function b64ToBuf(b){var bin=atob(b),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer}
function capTri(n){if(n>MAXTRI)throw new Error('삼각형이 '+n.toLocaleString()+'개예요. 12만 개 이하로 단순화해 주세요.')}
function parseOFF(buf){
  var L=new TextDecoder().decode(buf).split(/\r?\n/).map(function(l){return l.replace(/#.*/,'').trim()}).filter(Boolean);
  var h=L[0].split(/\s+/),li=1,nv,nf;
  if(!/^OFF$/i.test(h[0]))throw new Error('OFF 파일을 읽을 수 없어요.');
  if(h.length>=3){nv=+h[1];nf=+h[2]}else{var c=L[li++].split(/\s+/);nv=+c[0];nf=+c[1]}
  var v=[],i;for(i=0;i<nv;i++){var t=L[li++].split(/\s+/);v.push([+t[0],+t[1],+t[2]])}
  var out=[];
  for(i=0;i<nf;i++){var f=L[li++].split(/\s+/).map(Number),n=f[0];
    for(var k=1;k<n-1;k++){var a=v[f[1]],b=v[f[1+k]],c2=v[f[2+k]];if(a&&b&&c2){out.push(a[0],a[1],a[2],b[0],b[1],b[2],c2[0],c2[1],c2[2])}}
    capTri(out.length/9)}
  if(!out.length)throw new Error('OFF 파일에서 면을 찾지 못했어요.');
  return Float32Array.from(out);
}
function parsePLY(buf){
  var u8=new Uint8Array(buf),txt=new TextDecoder('latin1').decode(u8.subarray(0,Math.min(u8.length,8192)));
  var he=txt.indexOf('end_header');if(he<0)throw new Error('PLY 헤더를 읽을 수 없어요.');
  var after=txt.indexOf('\n',he)+1,lines=txt.slice(0,he).split(/\r?\n/),fmt='ascii',els=[],cur=null;
  lines.forEach(function(l){var p=l.trim().split(/\s+/);
    if(p[0]==='format')fmt=p[1];
    else if(p[0]==='element'){cur={name:p[1],n:+p[2],props:[]};els.push(cur)}
    else if(p[0]==='property'&&cur){if(p[1]==='list')cur.props.push({list:true,ct:p[2],it:p[3],name:p[4]});else cur.props.push({type:p[1],name:p[2]})}});
  var TY={char:['Int8',1],int8:['Int8',1],uchar:['Uint8',1],uint8:['Uint8',1],short:['Int16',2],int16:['Int16',2],ushort:['Uint16',2],uint16:['Uint16',2],int:['Int32',4],int32:['Int32',4],uint:['Uint32',4],uint32:['Uint32',4],float:['Float32',4],float32:['Float32',4],double:['Float64',8],float64:['Float64',8]};
  var verts=[],faces=[];
  function take(el,rec){if(el.name==='vertex')verts.push([rec.x,rec.y,rec.z]);else if(el.name==='face')faces.push(rec.vertex_indices||rec.vertex_index||[])}
  if(fmt==='ascii'){
    var body=new TextDecoder().decode(u8.subarray(after)).split(/\r?\n/),li=0;
    els.forEach(function(el){for(var r=0;r<el.n;r++){var tk=(body[li++]||'').trim().split(/\s+/),ti=0,rec={};
      el.props.forEach(function(pr){if(pr.list){var c=+tk[ti++],arr=[];for(var q=0;q<c;q++)arr.push(+tk[ti++]);rec[pr.name]=arr}else rec[pr.name]=+tk[ti++]});take(el,rec)}});
  }else{
    var le=fmt==='binary_little_endian',dv=new DataView(buf),o=after;
    els.forEach(function(el){for(var r=0;r<el.n;r++){var rec={};
      el.props.forEach(function(pr){
        if(pr.list){var ct=TY[pr.ct],it=TY[pr.it];if(!ct||!it)throw new Error('지원하지 않는 PLY 형식이에요.');var c=dv['get'+ct[0]](o,le);o+=ct[1];var arr=[];for(var q=0;q<c;q++){arr.push(dv['get'+it[0]](o,le));o+=it[1]}rec[pr.name]=arr}
        else{var t=TY[pr.type];if(!t)throw new Error('지원하지 않는 PLY 형식이에요.');rec[pr.name]=dv['get'+t[0]](o,le);o+=t[1]}});
      take(el,rec)}});
  }
  var out=[];
  faces.forEach(function(f){for(var k=1;k<f.length-1;k++){var a=verts[f[0]],b=verts[f[k]],c=verts[f[k+1]];if(a&&b&&c)out.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2])}capTri(out.length/9)});
  if(!out.length)throw new Error('PLY 파일에서 면을 찾지 못했어요. (점만 있는 파일은 사용할 수 없어요)');
  return Float32Array.from(out);
}
function gltfCore(j,bins){
  var T=THREE,out=[];
  var buffers=(j.buffers||[]).map(function(b){
    if(b.uri){var m=/^data:[^,]*;base64,(.*)$/.exec(b.uri);if(!m)throw new Error('외부 .bin 파일을 쓰는 GLTF는 읽을 수 없어요. GLB로 저장하거나 데이터를 내장해 주세요.');return b64ToBuf(m[1])}
    return bins[0];
  });
  function acc(i){
    var a=j.accessors[i],bv=j.bufferViews[a.bufferView],dv=new DataView(buffers[bv.buffer]);
    var nc={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],cs={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
    if(!nc||!cs)throw new Error('지원하지 않는 GLTF 데이터예요.');
    var stride=bv.byteStride||cs*nc,off=(bv.byteOffset||0)+(a.byteOffset||0),d=new Float64Array(a.count*nc);
    for(var n=0;n<a.count;n++)for(var c=0;c<nc;c++){var p=off+n*stride+c*cs,v;
      switch(a.componentType){case 5126:v=dv.getFloat32(p,true);break;case 5125:v=dv.getUint32(p,true);break;case 5123:v=dv.getUint16(p,true);break;case 5122:v=dv.getInt16(p,true);break;case 5121:v=dv.getUint8(p);break;default:v=dv.getInt8(p)}
      d[n*nc+c]=v}
    return d;
  }
  var nodes=j.nodes||[],isChild={};nodes.forEach(function(n){(n.children||[]).forEach(function(c){isChild[c]=1})});
  var sc=j.scenes&&j.scenes[j.scene||0],roots=(sc&&sc.nodes)||nodes.map(function(_,i){return i}).filter(function(i){return !isChild[i]});
  function visit(ni,PM){
    var n=nodes[ni],M=new T.Matrix4();
    if(n.matrix)M.fromArray(n.matrix);
    else{var tr=n.translation||[0,0,0],ro=n.rotation||[0,0,0,1],s2=n.scale||[1,1,1];M.compose(new T.Vector3(tr[0],tr[1],tr[2]),new T.Quaternion(ro[0],ro[1],ro[2],ro[3]),new T.Vector3(s2[0],s2[1],s2[2]))}
    var W=PM.clone().multiply(M);
    if(n.mesh!=null){
      (j.meshes[n.mesh].primitives||[]).forEach(function(pr){
        if(pr.mode!=null&&pr.mode!==4)return;
        var pos=acc(pr.attributes.POSITION),idx=pr.indices!=null?acc(pr.indices):null,cnt=idx?idx.length:pos.length/3,v=new T.Vector3();
        for(var t=0;t<cnt;t++){var vi=idx?idx[t]:t;v.set(pos[vi*3],pos[vi*3+1],pos[vi*3+2]).applyMatrix4(W);out.push(v.x,v.y,v.z)}
        capTri(out.length/9);
      });
    }
    (n.children||[]).forEach(function(c){visit(c,W)});
  }
  roots.forEach(function(r){visit(r,new T.Matrix4())});
  if(!out.length)throw new Error('GLTF/GLB에서 삼각형 메시를 찾지 못했어요.');
  return Float32Array.from(out);
}
function parseGLB(buf){
  var dv=new DataView(buf);if(dv.getUint32(0,true)!==0x46546C67)throw new Error('GLB 파일이 아니에요.');
  var o=12,json=null,bin=null;
  while(o<buf.byteLength){var len=dv.getUint32(o,true),ty=dv.getUint32(o+4,true),data=buf.slice(o+8,o+8+len);
    if(ty===0x4E4F534A)json=JSON.parse(new TextDecoder().decode(data));else if(ty===0x004E4942&&!bin)bin=data;o+=8+len}
  if(!json)throw new Error('GLB 내용을 읽을 수 없어요.');
  return gltfCore(json,[bin]);
}
function parseGLTF(buf){return gltfCore(JSON.parse(new TextDecoder().decode(buf)),[])}
function sniffAndParse(buf){
  var h=String.fromCharCode.apply(null,new Uint8Array(buf,0,Math.min(buf.byteLength,16)));
  if(h.slice(0,4)==='glTF')return parseGLB(buf);
  if(h.slice(0,3)==='ply')return parsePLY(buf);
  if(/^OFF/i.test(h))return parseOFF(buf);
  if(h.trim().charAt(0)==='{')return parseGLTF(buf);
  if(isBinarySTL(buf)||h.slice(0,5).toLowerCase()==='solid')return parseSTL(buf);
  return parseOBJ(buf);
}
/* HTML is never executed: it is read as plain text and only 3D data inside it is extracted. */
function parseHTMLModel(buf){
  var txt=new TextDecoder().decode(buf),m,re=/data:[^;,"'\s]*;base64,([A-Za-z0-9+\/=]{60,})/g;
  while((m=re.exec(txt))){try{return sniffAndParse(b64ToBuf(m[1]))}catch(e){}}
  var st=/solid[\s\S]*?endsolid/i.exec(txt);
  if(st&&/vertex\s/.test(st[0])){try{return parseSTL(new TextEncoder().encode(st[0]).buffer)}catch(e){}}
  var lines=txt.split(/\r?\n/).filter(function(l){return /^\s*(v|f)\s+[-\d]/.test(l)});
  if(lines.some(function(l){return /^\s*v\s/.test(l)})&&lines.some(function(l){return /^\s*f\s/.test(l)})){
    try{return parseOBJ(new TextEncoder().encode(lines.join('\n')).buffer)}catch(e){}}
  throw new Error('이 HTML에서 3D 모델 데이터를 찾지 못했어요. HTML은 실행하지 않고, 안에 든 STL·OBJ 텍스트나 base64 모델 데이터만 읽어요.');
}
function handleBuffer(buf,e,name){
  try{
    var pos;
    if(e==='stl')pos=parseSTL(buf);else if(e==='obj')pos=parseOBJ(buf);else if(e==='ply')pos=parsePLY(buf);else if(e==='off')pos=parseOFF(buf);
    else if(/^html?$/.test(e))pos=parseHTMLModel(buf);else pos=sniffAndParse(buf);
    sim.srcPos=pos;sim.srcZup=!(e==='glb'||e==='gltf');
    placeAttachment();setMsg('');setNote($('#simNote'),name+' 모델을 배치했어요.');
  }catch(err){setNote($('#simNote'),err.message,true)}
}
$('#modelFile').addEventListener('change',function(){
  var f=this.files[0];if(!f)return;
  var e=ext(f.name);
  if(!SIM_EXT.test(e)){setNote($('#simNote'),'STL, OBJ, PLY, OFF, GLB, GLTF, HTML 파일만 사용할 수 있어요.',true);return}
  if(f.size>20*1048576){setNote($('#simNote'),'20MB 이하 파일을 올려 주세요.',true);return}
  var rd=new FileReader();rd.onload=function(){handleBuffer(rd.result,e,f.name)};
  rd.onerror=function(){setNote($('#simNote'),'파일을 읽지 못했어요.',true)};rd.readAsArrayBuffer(f);this.value='';
});
function loadSharedModel(m,url,e){
  if(!sim.started){setNote($('#uNote'),'먼저 위의 3D 시뮬레이션을 시작해 주세요.',true);document.getElementById('simulation').scrollIntoView();return}
  if(m.file){m.file.arrayBuffer().then(function(b){handleBuffer(b,e,m.name||m.fileName)});document.getElementById('simulation').scrollIntoView();return}
  fetch(url).then(function(r){if(!r.ok)throw 0;return r.arrayBuffer()}).then(function(b){
    if(b.byteLength>20*1048576)throw new Error('20MB를 넘는 모델은 시뮬레이터에 불러올 수 없어요.');
    handleBuffer(b,e,m.name||m.fileName);document.getElementById('simulation').scrollIntoView();
  }).catch(function(err){setNote($('#simNote'),err&&err.message?err.message:'공유 모델을 불러오지 못했어요.',true)});
}

/* --- attachment placement + collision grid --- */
function clearAttachment(){
  if(sim.att){sim.scene.remove(sim.att);sim.att.geometry.dispose();sim.att=null}
  sim.tris=null;sim.grid=null;sim.srcPos=null;
}
function placeAttachment(){
  if(!sim.srcPos||!sim.started)return;
  var src=sim.srcPos,n=src.length/3,zup=$('#zUp').checked&&sim.srcZup!==false;
  if(sim.srcZup===false)zup=false;
  var a=new Float32Array(src.length),i;
  for(i=0;i<n;i++){var x=src[i*3],y=src[i*3+1],z=src[i*3+2];
    if(zup){a[i*3]=x;a[i*3+1]=z;a[i*3+2]=-y}else{a[i*3]=x;a[i*3+1]=y;a[i*3+2]=z}}
  var mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(i=0;i<n;i++)for(var k=0;k<3;k++){var v=a[i*3+k];if(v<mn[k])mn[k]=v;if(v>mx[k])mx[k]=v}
  var size=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])||1;
  var target=Math.min(300,Math.max(5,num('#mLen')||40)),sc=target/size,gap=Math.max(-60,Math.min(200,isNaN(num('#mGap'))?0:num('#mGap'))),o=outlet();
  var cx=(mn[0]+mx[0])/2,cz=(mn[2]+mx[2])/2;
  for(i=0;i<n;i++){
    a[i*3]=(a[i*3]-cx)*sc+o.x;
    a[i*3+1]=(a[i*3+1]-mx[1])*sc+o.y-gap;
    a[i*3+2]=(a[i*3+2]-cz)*sc+o.z;
  }
  if(sim.att){sim.scene.remove(sim.att);sim.att.geometry.dispose()}
  var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(a,3));geo.computeVertexNormals();
  sim.att=new THREE.Mesh(geo,new THREE.MeshPhongMaterial({color:0xf2b705,specular:0x777777,shininess:60,side:THREE.DoubleSide}));sim.att.castShadow=true;sim.att.receiveShadow=true;
  sim.scene.add(sim.att);
  sim.tris=a;buildGrid(a);
}
var GR=48;
function buildGrid(a){
  var nT=a.length/9,minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minZ=1e9,maxZ=-1e9,i;
  for(i=0;i<a.length;i+=3){
    if(a[i]<minX)minX=a[i];if(a[i]>maxX)maxX=a[i];
    if(a[i+1]<minY)minY=a[i+1];if(a[i+1]>maxY)maxY=a[i+1];
    if(a[i+2]<minZ)minZ=a[i+2];if(a[i+2]>maxZ)maxZ=a[i+2];
  }
  var g={minX:minX-1,maxX:maxX+1,minY:minY-1,maxY:maxY+1,minZ:minZ-1,maxZ:maxZ+1,cells:new Array(GR*GR)};
  g.sx=(g.maxX-g.minX)/GR;g.sz=(g.maxZ-g.minZ)/GR;
  for(i=0;i<nT;i++){
    var o=i*9,x0=Math.min(a[o],a[o+3],a[o+6]),x1=Math.max(a[o],a[o+3],a[o+6]),z0=Math.min(a[o+2],a[o+5],a[o+8]),z1=Math.max(a[o+2],a[o+5],a[o+8]);
    var ix0=cl(Math.floor((x0-g.minX)/g.sx)),ix1=cl(Math.floor((x1-g.minX)/g.sx)),iz0=cl(Math.floor((z0-g.minZ)/g.sz)),iz1=cl(Math.floor((z1-g.minZ)/g.sz));
    for(var ix=ix0;ix<=ix1;ix++)for(var iz=iz0;iz<=iz1;iz++){var c=ix*GR+iz;(g.cells[c]||(g.cells[c]=[])).push(i)}
  }
  sim.grid=g;
}
function cl(v){return v<0?0:v>=GR?GR-1:v}
function segHit(ax,ay,az,bx,by,bz){
  var g=sim.grid,t=sim.tris;if(!g)return null;
  if(Math.max(ax,bx)<g.minX||Math.min(ax,bx)>g.maxX||Math.max(az,bz)<g.minZ||Math.min(az,bz)>g.maxZ||Math.min(ay,by)>g.maxY||Math.max(ay,by)<g.minY)return null;
  var c0=cl(Math.floor((ax-g.minX)/g.sx))*GR+cl(Math.floor((az-g.minZ)/g.sz)),c1=cl(Math.floor((bx-g.minX)/g.sx))*GR+cl(Math.floor((bz-g.minZ)/g.sz));
  var dx=bx-ax,dy=by-ay,dz=bz-az,best=null,bt=2;
  var ns=Math.min(80,Math.ceil(Math.max(Math.abs(dx)/g.sx,Math.abs(dz)/g.sz)*2)+1),lastCell=-1;
  for(var pass=0;pass<=ns;pass++){
    var qx0=ax+dx*pass/ns,qz0=az+dz*pass/ns;
    var cell=cl(Math.floor((qx0-g.minX)/g.sx))*GR+cl(Math.floor((qz0-g.minZ)/g.sz));
    if(cell===lastCell)continue;lastCell=cell;
    var list=g.cells[cell];if(!list)continue;
    for(var q=0;q<list.length;q++){
      var o=list[q]*9,
        e1x=t[o+3]-t[o],e1y=t[o+4]-t[o+1],e1z=t[o+5]-t[o+2],e2x=t[o+6]-t[o],e2y=t[o+7]-t[o+1],e2z=t[o+8]-t[o+2],
        px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;
      if(det>-1e-9&&det<1e-9)continue;
      var inv=1/det,tx=ax-t[o],ty=ay-t[o+1],tz=az-t[o+2],u=(tx*px+ty*py+tz*pz)*inv;
      if(u<-1e-4||u>1.0001)continue;
      var qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;
      if(v<-1e-4||u+v>1.0001)continue;
      var tt=(e2x*qx+e2y*qy+e2z*qz)*inv;
      if(tt<0||tt>1||tt>=bt)continue;
      var nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x,nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      nx/=nl;ny/=nl;nz/=nl;
      if(nx*dx+ny*dy+nz*dz>0){nx=-nx;ny=-ny;nz=-nz}
      bt=tt;best={t:tt,nx:nx,ny:ny,nz:nz};
    }
  }
  return best;
}

/* --- particles --- */
var GRAV=9810;
sim.vol=0;sim.tsec=0;sim.volDraw=0;
function fmtVol(ml){return ml<1000?(ml<10?ml.toFixed(1):Math.round(ml))+' mL':(ml/1000).toFixed(2)+' L'}
function drawVol(){
  var qe=FLOW.q*FLOW.k;
  $('#volVal').textContent=fmtVol(sim.vol);
  $('#volTime').textContent='시뮬레이션 시간 '+sim.tsec.toFixed(1)+'초';
  $('#volRate').textContent=FLOW.q>0?'현재 유량 '+qe.toFixed(2)+' L/분':'유량을 먼저 입력하세요';
  $('#volCup').textContent=sim.vol>=180?'종이컵(180 mL) 약 '+(sim.vol/180).toFixed(1)+'잔':'';
}
function updateSpeed(){var v=+$('#speedRange').value||1;sim.speed=v;$('#speedVal').textContent=v.toFixed(1)+'x';$('#speedRange').setAttribute('aria-valuetext',v.toFixed(1)+'배속')}
$('#speedRange').addEventListener('input',updateSpeed);updateSpeed();
function resetVol(){sim.vol=0;sim.tsec=0;drawVol()}
function spawnP(x,y,z,vx,vy,vz,kind,age,tb){
  var i,tries=0;tb=tb||0;
  do{i=P.next;P.next=(P.next+1)%MAXP;tries++}while(P.alive[i]&&tries<MAXP);
  if(P.alive[i])return false;
  var k=i*3;P.pos[k]=x;P.pos[k+1]=y;P.pos[k+2]=z;P.vel[k]=vx;P.vel[k+1]=vy;P.vel[k+2]=vz;
  P.age[i]=age||0;P.alive[i]=1;P.kind[i]=kind;P.tb[i]=tb;
  var base=Math.max(2,Math.min(4.6,FLOW.d*.45));
  P.size[i]=kind?1.5+Math.random()*.8:base*(1.2+.5*tb+(Math.random()-.4)*1.1*tb);
  P.a0[i]=kind?.8:.5+.47*tb;P.alpha[i]=P.a0[i];return true;
}
/* Flow regime from the valve opening k (photos: 50% = thin glassy laminar jet, 100% = white fanning turbulent plume) */
function turb(){var s=Math.max(0,Math.min(1,(FLOW.k-.5)/.5));return s*s*(3-2*s)}
function exitSpeed(){var rad=Math.max(.8,FLOW.d/2),A=Math.PI*rad*rad;return Math.max(150,Math.min(1800,FLOW.q*FLOW.k*1e6/60/A*.9))}
/* tOff = how long ago (s) inside this frame the drop left the outlet, so drops never bunch up per frame */
function spawn(tOff){
  var o=outlet(),T=turb(),k=FLOW.k,fill=(.6+.4*Math.min(1,k/.5))*(1+.35*T),rad=Math.max(.8,FLOW.d/2)*fill;
  var ang=Math.random()*6.2832,rr=Math.sqrt(Math.random())*rad*.9,v=exitSpeed();
  // fan angle grows with turbulence (≈0.7° laminar -> ≈12° turbulent); laminar jet gets a faint sideways wobble
  var tn=.012+.5*T,la=Math.random()*6.2832,lm=Math.sqrt(Math.random())*v*tn,wob=(1-T)*v*.012*Math.sin(sim.tw*9+rr);
  var vx=Math.cos(la)*lm+wob,vz=Math.sin(la)*lm;
  spawnP(o.x+Math.cos(ang)*rr,o.y-1-v*tOff-.5*GRAV*tOff*tOff,o.z+Math.sin(ang)*rr,vx,-(v+GRAV*tOff),vz,0,tOff,T);
  if(T>.15){var nm=Math.random()<T*.9?(Math.random()<T*.8?2:1):0;for(var mi=0;mi<nm;mi++){var a2=Math.random()*6.2832,s2=30+Math.random()*170*T;
    spawnP(o.x+Math.cos(a2)*rad,o.y-3,o.z+Math.sin(a2)*rad,Math.cos(a2)*s2,-v*.8,Math.sin(a2)*s2,1,0,T)}}
}
function step(dt){
  var useCol=$('#collide').checked&&sim.tris,landN=0,lx=0,lz=0,lx2=0,lz2=0;sim.tw=(sim.tw||0)+dt;
  for(var i=0;i<MAXP;i++){
    if(!P.alive[i])continue;var k=i*3,kind=P.kind[i];
    P.vel[k+1]-=GRAV*dt;P.age[i]+=dt;
    if(P.tb[i]>.02&&!kind){var ja=42000*P.tb[i]*dt;P.vel[k]+=(Math.random()-.5)*ja;P.vel[k+2]+=(Math.random()-.5)*ja}
    var x0=P.pos[k],y0=P.pos[k+1],z0=P.pos[k+2],x1=x0+P.vel[k]*dt,y1=y0+P.vel[k+1]*dt,z1=z0+P.vel[k+2]*dt;
    if(useCol){
      var hit=segHit(x0,y0,z0,x1,y1,z1);
      if(hit){
        var vd=P.vel[k]*hit.nx+P.vel[k+1]*hit.ny+P.vel[k+2]*hit.nz,e=1.08;
        P.vel[k]=(P.vel[k]-e*vd*hit.nx)*.85;P.vel[k+1]=(P.vel[k+1]-e*vd*hit.ny)*.85;P.vel[k+2]=(P.vel[k+2]-e*vd*hit.nz)*.85;
        x1=x0+(x1-x0)*hit.t+hit.nx*.5;y1=y0+(y1-y0)*hit.t+hit.ny*.5;z1=z0+(z1-z0)*hit.t+hit.nz*.5;
        if(!kind&&Math.random()<.02+.08*P.tb[i]){var sp3=90+P.tb[i]*200;spawnP(x1,y1,z1,hit.nx*sp3+(Math.random()-.5)*sp3,hit.ny*sp3+30+Math.random()*sp3,hit.nz*sp3+(Math.random()-.5)*sp3,1,0,P.tb[i])}
      }
    }
    var life=kind?.5:4;
    if(y1<0){
      if(!kind){
        landN++;lx+=x1;lz+=z1;lx2+=x1*x1;lz2+=z1*z1;
        var tbL=P.tb[i];if(Math.random()<.07+.5*tbL){var a=Math.random()*6.2832,sp=(40+Math.random()*90)*(1+tbL*2.6);spawnP(x1,.8,z1,Math.cos(a)*sp,(60+Math.random()*160)*(1+tbL*2.4),Math.sin(a)*sp,1,0,tbL)}
      }
      P.alive[i]=0;P.pos[k+1]=-9999;P.size[i]=0;continue;
    }
    if(P.age[i]>life||Math.abs(x1)>600||z1<-5||z1>900){P.alive[i]=0;P.pos[k+1]=-9999;P.size[i]=0;continue}
    P.alpha[i]=P.a0[i]*Math.min(1,(life-P.age[i])/.2);
    P.pos[k]=x1;P.pos[k+1]=y1;P.pos[k+2]=z1;
  }
  var qe=FLOW.q*FLOW.k,Tn=turb(),sg=(1.3+1.4*Tn)*(1+6*(1-Math.min(1,FLOW.k/.25))),rate=qe<=0.001?0:Math.min(5000,exitSpeed()*3.2/sg);sim.acc+=rate*dt;
  var n=Math.floor(sim.acc);sim.acc-=n;
  for(var j=0;j<n;j++)spawn(dt*(j+Math.random())/n);
  var pd=sim.pud;
  if(pd){
    if(landN>0){
      var mx=lx/landN,mz=lz/landN,spread=Math.sqrt(Math.max(0,lx2/landN-mx*mx)+Math.max(0,lz2/landN-mz*mz)),rad=Math.max(6,5+2.4*spread)*(1+.3*turb());
      if(!pd.visible)pd.position.set(mx,1,mz);else{pd.position.x+=(mx-pd.position.x)*.2;pd.position.z+=(mz-pd.position.z)*.2}
      var sc=pd.scale.x||rad;pd.scale.set(sc+(rad-sc)*.15,sc+(rad-sc)*.15,1);pd.visible=true;sim.pudT=.5;
    }else if(pd.visible){sim.pudT-=dt;if(sim.pudT<=0)pd.visible=false}
  }
  var at=sim.pts.geometry.attributes;at.position.needsUpdate=true;at.aSize.needsUpdate=true;at.aAlpha.needsUpdate=true;
}
function loop(t){
  requestAnimationFrame(loop);
  if(!sim.started||!sim.visible)return;
  var dt=Math.min(.033,(t-sim.last)/1000||.016);sim.last=t;
  if(sim.running){
    var spd=sim.speed||1,tot=dt*spd,ns=Math.max(1,Math.min(10,Math.ceil(tot/.007)));
    for(var si=0;si<ns;si++)step(tot/ns);
    var dtw=Math.min(.25,(t-(sim.lastV||t))/1000||0)*spd;sim.tsec+=dtw;sim.vol+=FLOW.q*FLOW.k*1000/60*dtw;
    if(t-sim.volDraw>100){sim.volDraw=t;drawVol()}
  }
  sim.lastV=t;
  sim.ren.render(sim.scene,sim.cam);
}


/* nav highlight */
(function(){
  var links=[].slice.call(document.querySelectorAll('nav a'));
  if(!window.IntersectionObserver)return;
  var map={};links.forEach(function(a){map[a.getAttribute('href').slice(1)]=a});
  var io=new IntersectionObserver(function(en){
    en.forEach(function(e){if(e.isIntersecting){links.forEach(function(a){a.classList.remove('active')});if(map[e.target.id])map[e.target.id].classList.add('active')}});
  },{rootMargin:'-35% 0px -55% 0px'});
  Object.keys(map).forEach(function(id){var el=document.getElementById(id);if(el)io.observe(el)});
})();


/* ================= tutorial ================= */
(function(){
  var STEPS=[
    {t:'튜토리얼을 시작해요',x:'이 사이트로 할 수 있는 일을 순서대로 안내할게요. 키보드 ← → 로도 넘길 수 있어요.',sel:null,go:'#top'},
    {t:'1. 3D 시뮬레이션 시작',x:'“3D 시뮬레이션 시작”을 누르면 수도꼭지와 물줄기가 나타나요. 드래그로 회전, 휠이나 두 손가락으로 확대할 수 있어요. 아래 “물줄기 출력” 슬라이더로 0~100%까지 물의 세기를 조절하고, 로그인하지 않았다면 공동 저장 안내 창이 떠요.',sel:'#startBtn'},
    {t:'2. 모델 올리기',x:'STL·OBJ 파일을 올리거나 “예제 모델 배치”(수도꼭지에 끼우는 층류 캡)를 눌러 수도꼭지 아래에 부착물을 놓아 보세요. “모델 최대 길이”에 실제 크기(mm)를 넣으면 그 크기로 맞춰져요.',sel:'#upLabel'},
    {t:'3. 충돌 켜고 끄기',x:'체크하면 물이 모델 표면에 부딪혀 흘러요. 끄면 같은 출구 조건의 직선 흐름이 나와서 전후 비교가 쉬워요.',sel:'#collide',up:'label'},
    {t:'4. 유량과 출구 지름 입력',x:'① 양동이로 받은 물의 양(mL)과 걸린 시간(초)으로 기존 유량을 구하고, ② 기존·개선 출구 지름(mm)을 넣으면 개선 유량이 추정돼요. 개선품도 직접 재었다면 ③에 넣어 측정값으로 계산할 수 있어요.',sel:'#qV',up:'.stack'},
    {t:'5. 결과 읽기',x:'기존 유량, 개선 유량, 절수율, 1분당 절수량이 바로 계산돼요. 값은 예시이니 실제 측정값으로 바꿔 주세요.',sel:'.results'},
    {t:'6. 내 모델·자료 공유',x:'작성자와 파일을 고르고 “모델 공유하기”를 누르면 모두가 볼 수 있어요. STL·OBJ는 “시뮬레이터에 불러오기”로 바로 확인할 수 있어요.',sel:'#problem .grid2 > .panel:first-child'},
    {t:'7. 공동 수도꼭지 치수',x:'벽에서 출수구까지, 전체 높이, 연결부 외경을 바꾸고 저장하면 3D 모델이 그 치수로 다시 만들어져요. 마지막으로 저장한 값이 모두의 기준이 돼요.',sel:'#problem .grid2 > .panel:last-child'},
    {t:'8. 멤버 공간',x:'닉네임만 정하면 소통, 산출물 제안, 산출물 결과 탭에 글을 남길 수 있어요. 올라온 글은 누구나 삭제할 수 있어요.',sel:'#community .panel',pre:function(){document.getElementById('tab-talk').click()}},
    {t:'9. 실험로그 올리기',x:'“실험로그” 탭에서 실험 일자를 고르고, 작성자와 실험 내용을 적어요. 한 번에 실험 하나씩 기록하세요. 게시 일자와 시간은 올리는 순간 자동으로 남아요.',sel:'#lgDate',up:'.stack',pre:function(){document.getElementById('tab-log').click()}},
    {t:'10. 모델 이미지 첨부',x:'실험한 모델의 사진이나 캡처를 20MB 이하로 첨부하면 로그 목록에 미리보기로 보여요. 실험로그 파일에는 그림 대신 이미지 파일 이름이 기록돼요.',sel:'#lgImg',pre:function(){document.getElementById('tab-log').click()}},
    {t:'11. 실험로그 파일 (실시간 기록)',x:'누가 실험로그를 올리든 실험로그 파일에 바로 추가돼요. 상태 줄에서 총 건수와 마지막 기록 시각을 확인하고, “파일 내용 보기”로 열어 보거나 TXT·CSV로 내려받을 수 있어요.',sel:'#logSync',up:'.syncbox',pre:function(){document.getElementById('tab-log').click()}},
    {t:'12. 기록 확인과 삭제',x:'각 로그에 “✓ 파일에 기록됨” 표시가 붙어요. 올라온 로그는 누구나 삭제할 수 있고(“삭제” 후 “정말 삭제”), 삭제하면 실험로그 파일에서도 빠져요. PDF·DOCX로도 내려받을 수 있어요.',sel:'#lgFeed',pre:function(){document.getElementById('tab-log').click()}},
    {t:'13. 예상 절수량 계산',x:'기존·개선 유량, 사용 시간, 하루 사용 횟수를 넣으면 하루에 아끼는 물의 양을 계산해 줘요.',sel:'#impact .panel'},
    {t:'14. 실험 기록 표',x:'“측정 추가”로 회차를 늘리고 물 사용량과 젖은 부피를 적으세요. 감소율이 자동 계산되고, CSV로 내려받을 수 있어요.',sel:'#lAdd',up:'.log-actions'},
    {t:'15. 문제가 생기면 Q&A',x:'업로드·삭제·내려받기·3D 화면 등 자주 생기는 문제는 상단 “Q&A” 버튼에서 원인과 해결 방법을 찾아볼 수 있어요.',sel:'#qaBtn'}
  ];
  var i=0,open=false,hl=null,$t=function(s){return document.querySelector(s)};
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clearHl(){if(hl){hl.classList.remove('tut-hl');hl=null}}
  function show(n){
    i=Math.max(0,Math.min(STEPS.length-1,n));var st=STEPS[i];
    $t('#tutStep').textContent=(i+1)+' / '+STEPS.length;
    $t('#tutTitle').textContent=st.t;$t('#tutText').textContent=st.x;
    var dots=$t('#tutDots');dots.textContent='';
    STEPS.forEach(function(_,k){var d=document.createElement('i');if(k===i)d.className='on';dots.append(d)});
    $t('#tutPrev').disabled=i===0;$t('#tutNext').textContent=i===STEPS.length-1?'완료':'다음';
    clearHl();
    if(st.pre){try{st.pre()}catch(e){}}
    var el=null;
    if(st.sel){el=$t(st.sel);if(el&&st.up)el=el.closest(st.up)||el}
    if(el){
      hl=el;el.classList.add('tut-hl');
      var tall=el.getBoundingClientRect().height>window.innerHeight*.5;
      el.scrollIntoView({behavior:reduce?'auto':'smooth',block:tall?'start':'center'});
    }else if(st.go){var g=$t(st.go);if(g)g.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'})}
  }
  function start(){
    open=true;$t('#tut').hidden=false;$t('#tutToast').hidden=true;
    try{localStorage.setItem('hos.tutSeen','1')}catch(e){}
    show(0);$t('#tutNext').focus({preventScroll:true});
  }
  function stop(){open=false;$t('#tut').hidden=true;clearHl()}
  $t('#tutBtn').addEventListener('click',function(){open?stop():start()});
  $t('#tutBtn2').addEventListener('click',start);
  $t('#tutToastGo').addEventListener('click',start);
  $t('#tutToastX').addEventListener('click',function(){$t('#tutToast').hidden=true;try{localStorage.setItem('hos.tutSeen','1')}catch(e){}});
  $t('#tutClose').addEventListener('click',stop);
  $t('#tutPrev').addEventListener('click',function(){show(i-1)});
  $t('#tutNext').addEventListener('click',function(){if(i>=STEPS.length-1)stop();else show(i+1)});
  document.addEventListener('keydown',function(e){
    if(!open)return;var tg=e.target&&e.target.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT')return;
    if(e.key==='Escape')stop();
    else if(e.key==='ArrowRight'){if(i<STEPS.length-1)show(i+1)}
    else if(e.key==='ArrowLeft'){show(i-1)}
  });
  var seen=false;try{seen=!!localStorage.getItem('hos.tutSeen')}catch(e){}
  if(!seen)setTimeout(function(){if(!open)$t('#tutToast').hidden=false},2500);
})();


/* ================= experiment log + live log file ================= */
var LOGS=[];
function todayStr(){var d=new Date(),m=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return d.getFullYear()+'-'+m+'-'+dd}
$('#lgDate').value=todayStr();$('#lgAuthor').value=MINE.nick||MINE.author||'';
function postedStr(ts){try{return new Date(ts).toLocaleString('ko-KR',{year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})}catch(e){return ''}}
function sortedLogs(){return LOGS.slice().sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0)})}
function fileText(){
  var list=sortedLogs();
  return '2026 호남삼육중학교 이공계 Step-in · 실험로그 파일\n내용 확인 시각: '+postedStr(Date.now())+' · 총 '+list.length+'건\n\n'+
    list.map(function(e,i){return '────────────────────────────\n#'+(i+1)+'\n실험 일자: '+e.expDate+'\n게시 일시: '+postedStr(e.createdAt)+'\n작성자: '+e.author+'\n실험 내용:\n'+e.body+'\n모델 이미지: '+(e.imageName||'없음')+'\n'}).join('\n');
}
function csvCell(v){v=String(v==null?'':v);return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function fileCsv(){
  var rows=[['번호','실험 일자','게시 일시','작성자','실험 내용','모델 이미지']];
  sortedLogs().forEach(function(e,i){rows.push([i+1,e.expDate,postedStr(e.createdAt),e.author,e.body,e.imageName||''])});
  return '\ufeff'+rows.map(function(r){return r.map(csvCell).join(',')}).join('\r\n');
}
function renderLogFile(){
  var el=$('#logSync'),sp=el.querySelector('span');el.classList.remove('on','off');
  if(!S.ready){sp.textContent='공동 저장 연결을 확인하는 중…';return}
  var last=LOGS.reduce(function(m,e){return Math.max(m,e.createdAt||0)},0);
  if(S.mode==='shared'){el.classList.add('on');sp.textContent='실험로그 파일 실시간 기록 중 · 총 '+LOGS.length+'건'+(last?' · 마지막 기록 '+postedStr(last):'')}
  else{el.classList.add('off');sp.textContent='공동 저장이 꺼진 보기예요. 이 브라우저에만 기록돼요. 서버에 다시 연결되면 새로고침했을 때 켜져요. (총 '+LOGS.length+'건)'}
  var pre=$('#lfPre');if(!pre.hidden)pre.textContent=LOGS.length?fileText():'아직 기록이 없어요.';
}
$('#lfView').addEventListener('click',function(){
  var pre=$('#lfPre');pre.hidden=!pre.hidden;this.textContent=pre.hidden?'파일 내용 보기':'파일 내용 접기';
  if(!pre.hidden)pre.textContent=LOGS.length?fileText():'아직 기록이 없어요.';
});
function saveLogFile(name,data){
  var note=$('#lfNote');
  if(!LOGS.length){setNote(note,'내려받을 기록이 아직 없어요.',true);return}
  if(!S.dl){setNote(note,'이 보기에서는 파일 저장을 쓸 수 없어요. “파일 내용 보기”에서 복사해 주세요.',true);return}
  S.dl.save({filename:name,data:data}).then(function(){setNote(note,'저장했어요.')})
    .catch(function(e){setNote(note,e&&e.code==='declined'?'저장을 취소했어요.':'저장하지 못했어요.',true)});
}

/* ---- PDF (with model images) and DOCX (opens in Hangul/Word) export ---- */
function wrapLines(ctx,text,maxW){
  var out=[];String(text).split(/\r?\n/).forEach(function(par){
    if(!par){out.push('');return}
    var line='';
    for(var i=0;i<par.length;i++){
      var t=line+par[i];
      if(ctx.measureText(t).width>maxW&&line){out.push(line);line=par[i]===' '?'':par[i]}else line=t;
    }
    out.push(line);
  });
  return out;
}
function loadImg(url){return new Promise(function(res){var im=new Image();im.onload=function(){res(im)};im.onerror=function(){res(null)};im.src=url})}
function makePdfPages(){
  var list=sortedLogs(),W=1190,H=1684,M=100,CW=W-2*M,FONT='"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
  var pages=[],ctx,y;
  function newPage(){var cv=document.createElement('canvas');cv.width=W;cv.height=H;ctx=cv.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.textBaseline='top';y=M;pages.push(cv)}
  function need(hh){if(y+hh>H-M)newPage()}
  function text(str,size,weight,color,lh){ctx.font=weight+' '+size+'px '+FONT;ctx.fillStyle=color;wrapLines(ctx,str,CW).forEach(function(l){need(lh);ctx.font=weight+' '+size+'px '+FONT;ctx.fillStyle=color;ctx.fillText(l,M,y);y+=lh})}
  newPage();
  text('2026 호남삼육중학교 이공계 Step-in · 실험로그',46,'700','#0d2b3c',66);
  text('만든 시각 '+postedStr(Date.now())+' · 총 '+list.length+'건',26,'400','#476270',40);y+=26;
  return Promise.all(list.map(function(e){var u=e.url||(e.imageId?'/_blob/'+e.imageId:'');return u?loadImg(u):Promise.resolve(null)})).then(function(imgs){
    list.forEach(function(e,i){
      need(230);ctx.fillStyle='#c5d8de';ctx.fillRect(M,y,CW,3);y+=22;
      text('#'+(i+1)+'  실험 일자 '+e.expDate+'  ·  작성자 '+e.author,30,'700','#0d2b3c',44);
      text('게시 일시 '+postedStr(e.createdAt),24,'400','#476270',36);y+=8;
      text(e.body||'',28,'400','#0d2b3c',42);y+=8;
      var im=imgs[i];
      if(im){
        var w=Math.min(CW,im.width),hh=im.height*(w/im.width);if(hh>520){w=w*520/hh;hh=520}
        need(hh+60);ctx.drawImage(im,M,y,w,hh);y+=hh+12;text('모델 이미지: '+(e.imageName||''),22,'400','#476270',32);
      }else if(e.imageName){text('모델 이미지: '+e.imageName+' (불러오지 못함)',22,'400','#476270',32)}
      y+=28;
    });
    return pages;
  });
}
function jpegBytes(cv){var d=cv.toDataURL('image/jpeg',0.88).split(',')[1],bin=atob(d),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
function buildPdf(pages){
  var enc=new TextEncoder(),chunks=[],pos=0,offs=[];
  function put(x){var b=typeof x==='string'?enc.encode(x):x;chunks.push(b);pos+=b.length}
  function obj(n,body){offs[n]=pos;put(n+' 0 obj\n'+body+'\nendobj\n')}
  put('%PDF-1.4\n');put(new Uint8Array([37,226,227,207,211,10]));
  var n=pages.length,pw=595,ph=842,kids=[],i;
  for(i=0;i<n;i++)kids.push((3+3*i)+' 0 R');
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
  obj(2,'<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+n+' >>');
  pages.forEach(function(cv,k){
    var jp=jpegBytes(cv),pid=3+3*k,cid=pid+1,iid=pid+2,cs='q '+pw+' 0 0 '+ph+' 0 0 cm /Im0 Do Q';
    obj(pid,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pw+' '+ph+'] /Resources << /XObject << /Im0 '+iid+' 0 R >> >> /Contents '+cid+' 0 R >>');
    obj(cid,'<< /Length '+cs.length+' >>\nstream\n'+cs+'\nendstream');
    offs[iid]=pos;put(iid+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+cv.width+' /Height '+cv.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jp.length+' >>\nstream\n');put(jp);put('\nendstream\nendobj\n');
  });
  var xr=pos,total=3*n+3;
  put('xref\n0 '+total+'\n0000000000 65535 f \n');
  for(var j=1;j<total;j++)put(String(offs[j]).padStart(10,'0')+' 00000 n \n');
  put('trailer\n<< /Size '+total+' /Root 1 0 R >>\nstartxref\n'+xr+'\n%%EOF');
  var out=new Uint8Array(pos),o=0;chunks.forEach(function(c){out.set(c,o);o+=c.length});return out;
}
var CRC_T=null;
function crc32(u){
  if(!CRC_T){CRC_T=[];for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CRC_T[n]=c>>>0}}
  var c2=0xFFFFFFFF;for(var i=0;i<u.length;i++)c2=CRC_T[(c2^u[i])&255]^(c2>>>8);return (c2^0xFFFFFFFF)>>>0;
}
function zipStore(files){
  var enc=new TextEncoder(),parts=[],central=[],off=0;
  function u16(v){return [v&255,(v>>8)&255]}
  function u32(v){return [v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255]}
  files.forEach(function(f){
    var nm=enc.encode(f.name),crc=crc32(f.data),len=f.data.length;
    var lh=[].concat(u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(crc),u32(len),u32(len),u16(nm.length),u16(0));
    parts.push(new Uint8Array(lh),nm,f.data);
    central.push(new Uint8Array([].concat(u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(crc),u32(len),u32(len),u16(nm.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off))),nm);
    off+=lh.length+nm.length+len;
  });
  var csz=0;central.forEach(function(c){csz+=c.length});
  var end=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(csz),u32(off),u16(0)));
  var all=parts.concat(central,[end]),tot=0;all.forEach(function(a){tot+=a.length});
  var out=new Uint8Array(tot),o=0;all.forEach(function(a){out.set(a,o);o+=a.length});return out;
}
function xmlEsc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function buildDocx(){
  var list=sortedLogs(),FONT='<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕" w:cs="Malgun Gothic"/>';
  function run(t,o){o=o||{};var br=String(t).split(/\r?\n/).map(function(l){return '<w:t xml:space="preserve">'+xmlEsc(l)+'</w:t>'}).join('<w:br/>');
    return '<w:r><w:rPr>'+FONT+(o.b?'<w:b/>':'')+(o.c?'<w:color w:val="'+o.c+'"/>':'')+'<w:sz w:val="'+(o.sz||22)+'"/></w:rPr>'+br+'</w:r>'}
  function para(t,o){o=o||{};return '<w:p><w:pPr><w:spacing w:after="'+(o.after==null?120:o.after)+'" w:line="320" w:lineRule="auto"/>'+(o.rule?'<w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="C5D8DE"/></w:pBdr>':'')+'</w:pPr>'+run(t,o)+'</w:p>'}
  var body=para('2026 호남삼육중학교 이공계 Step-in · 실험로그',{b:1,sz:40,after:60})+para('만든 시각 '+postedStr(Date.now())+' · 총 '+list.length+'건',{c:'476270',sz:20,after:240});
  list.forEach(function(e,i){
    body+=para('#'+(i+1)+'  실험 일자 '+e.expDate+'  ·  작성자 '+e.author,{b:1,sz:26,after:60,rule:1})+
      para('게시 일시 '+postedStr(e.createdAt),{c:'476270',sz:20,after:100})+
      para(e.body||'',{sz:22,after:100})+
      para('모델 이미지: '+(e.imageName||'없음')+(e.imageName?' (그림은 PDF에 포함돼요)':''),{c:'476270',sz:20,after:240});
  });
  var doc='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  var enc=new TextEncoder();
  return zipStore([
    {name:'[Content_Types].xml',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')},
    {name:'_rels/.rels',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')},
    {name:'word/document.xml',data:enc.encode(doc)}
  ]);
}
function saveBinary(label,name,make){
  var note=$('#lfNote');
  if(!LOGS.length){setNote(note,'내려받을 기록이 아직 없어요.',true);return}
  if(!S.dl){setNote(note,'이 보기에서는 파일 저장을 쓸 수 없어요. “파일 내용 보기”에서 복사해 주세요.',true);return}
  setNote(note,label+' 만드는 중…');
  Promise.resolve().then(make).then(function(data){return S.dl.save({filename:name,data:data})})
    .then(function(){setNote(note,label+'를 저장했어요.')})
    .catch(function(e){setNote(note,e&&e.code==='declined'?'저장을 취소했어요.':label+'를 만들거나 저장하지 못했어요'+errCode(e)+'.',true)});
}
$('#lfPdf').addEventListener('click',function(){saveBinary('PDF','step-in-2026-experiment-log.pdf',function(){return makePdfPages().then(buildPdf)})});
$('#lfDocx').addEventListener('click',function(){saveBinary('DOCX','step-in-2026-experiment-log.docx',buildDocx)});
$('#lfTxt').addEventListener('click',function(){saveLogFile('step-in-2026-experiment-log.txt',fileText())});
$('#lfCsv').addEventListener('click',function(){saveLogFile('step-in-2026-experiment-log.csv',fileCsv())});
function renderLogs(){
  var box=$('#lgFeed');box.textContent='';
  $('#lgCount').textContent=LOGS.length?LOGS.length+'건':'';
  if(!LOGS.length){box.append(h('div',{class:'empty',text:'아직 실험로그가 없어요. 첫 실험을 기록해 보세요.'}))}
  LOGS.slice(0,100).forEach(function(e){
    var mine=ANYONE_DELETES||MINE.logs.indexOf(e.id)>-1||S.admin,url=e.url||(e.imageId?'/_blob/'+e.imageId:'');
    var meta=h('div',{class:'logmeta'},h('span',{},'실험 ',h('b',{text:e.expDate||'-'})),h('span',{text:'게시 '+postedStr(e.createdAt)}),h('span',{text:e.author||'익명'}));
    var badge=S.mode==='shared'?h('span',{class:'badge ok',text:'✓ 파일에 기록됨'}):null;
    var head=h('header',{style:'justify-content:space-between;align-items:center'},meta,badge);
    var card=h('div',{class:'bubble'},head,h('p',{text:e.body||''}));
    if(url)card.append(h('img',{class:'thumb',src:url,alt:'모델 이미지: '+(e.imageName||''),loading:'lazy'}));
    if(mine)card.append(h('div',{style:'text-align:right;margin-top:4px'},delControl('log:'+e.id,function(){deleteLog(e)},renderLogs)));
    box.append(card);
  });
  renderLogFile();
}
function deleteLog(e){
  MINE.logs=MINE.logs.filter(function(x){return x!==e.id});saveMine();
  if(S.mode==='shared'&&S.db){LOGS=LOGS.filter(function(x){return x.id!==e.id});renderLogs();S.db.doc('explogs/'+e.id).delete().then(function(){REF.logs&&REF.logs();setNote($('#lgNote'),'삭제했어요.')}).catch(function(er){setNote($('#lgNote'),'삭제하지 못했어요'+errCode(er)+'. 권한을 확인해 주세요.',true);REF.logs&&REF.logs()})}
  else{LOGS=LOGS.filter(function(x){return x.id!==e.id});lsSet('hos.logs',LOGS.map(function(x){var c=Object.assign({},x);delete c.url;delete c.file;return c}));renderLogs()}
}
$('#lgBtn').addEventListener('click',function(){
  var note=$('#lgNote'),date=$('#lgDate').value,author=$('#lgAuthor').value.trim(),body=$('#lgBody').value.trim(),f=$('#lgImg').files[0];
  if(!date){setNote(note,'실험 일자를 선택해 주세요.',true);return}
  if(!author){setNote(note,'작성자를 입력해 주세요.',true);return}
  if(!body){setNote(note,'실험 내용을 입력해 주세요.',true);return}
  if(f&&!/^image\//.test(f.type||'')){setNote(note,'모델 이미지는 이미지 파일만 올릴 수 있어요.',true);return}
  if(f&&f.size>20*1048576){setNote(note,'이미지가 20MB를 넘어요. 더 작게 줄여 주세요.',true);return}
  MINE.nick=author;saveMine();
  var btn=$('#lgBtn');btn.disabled=true;setNote(note,'올리는 중…');
  var fin=function(m,w){btn.disabled=false;setNote(note,m,w)};
  var e={expDate:date,author:author,body:body,createdAt:Date.now()};
  if(f)e.imageName=f.name;
  var reset=function(){$('#lgBody').value='';$('#lgImg').value='';$('#lgDate').value=todayStr()};
  if(S.mode==='shared'&&S.db){
    var up=f?useCap('assets').then(function(as){if(!as)throw {code:'no_assets'};S.assets=as;return as.upload(f)}).then(function(r){e.imageId=r.id}):Promise.resolve();
    up.then(function(){return S.db.collection('explogs').add(e)}).then(function(ref){
      MINE.logs.push(ref.id);saveMine();reset();
      e.id=ref.id;if(!LOGS.some(function(x){return x.id===e.id})){LOGS.unshift(e);renderLogs()}
      fin('올렸어요. 실험로그 파일에 바로 기록됐어요.');REF.logs&&REF.logs();
    }).catch(function(er){fin(er&&er.code==='no_assets'?'이 보기에서는 이미지를 올릴 권한이 없어요.':'올리지 못했어요. 잠시 후 다시 시도해 주세요.',true)});
  }else{
    e.id='l'+Date.now().toString(36);if(f){e.url=URL.createObjectURL(f)}
    LOGS.unshift(e);lsSet('hos.logs',LOGS.map(function(x){var c=Object.assign({},x);delete c.url;return c}));MINE.logs.push(e.id);saveMine();reset();renderLogs();
    fin('올렸어요. (이 브라우저에만 저장돼요)');
  }
});
function startLogs(){
  if(S.mode==='shared'&&S.db){
    REF.logs=liveQuery(S.db.collection('explogs').orderBy('createdAt','desc').limit(500),function(list){LOGS=list;renderLogs()},$('#lgNote'));
  }else{LOGS=lsGet('hos.logs',[]);renderLogs()}
}
renderLogs();


/* ================= Q&A ================= */
(function(){
  var QA=[
    {t:'3D',q:'“3D 시뮬레이션 시작”을 눌러도 화면이 안 떠요 / “3D 엔진을 불러오지 못했어요”',
      c:['인터넷이 끊겼거나, 학교·기관 네트워크가 외부 스크립트(3D 엔진)를 막고 있어요.','브라우저의 그래픽 가속(WebGL)이 꺼져 있어요.','오래된 기기·브라우저예요.'],
      f:['인터넷 연결을 확인하고 새로고침하세요.','휴대전화 데이터나 다른 와이파이로 시도해 보세요.','브라우저 설정에서 “그래픽/하드웨어 가속 사용”을 켜세요.','최신 Chrome·Edge·Safari로 열어 보세요.']},
    {t:'3D',q:'3D 화면이 까맣거나 수도꼭지가 안 보여요',
      c:['시점이 너무 멀거나 너무 가까울 수 있어요.','그래픽 가속 문제이거나, 숨겨진 탭에서 시작해 화면 크기가 0이었어요.'],
      f:['“시점 맞추기”를 누르세요.','“초기화” 후 다시 시작해 보세요.','탭이 보이는 상태에서 새로고침한 뒤 시작하세요.','다른 브라우저로 열어 보세요.']},
    {t:'3D',q:'모델 파일을 올렸는데 아무 일도 안 일어나거나 오류가 떠요',
      c:['지원하지 않는 형식이에요. (STL·OBJ·PLY·OFF·GLB·GLTF·HTML만 가능)','파일이 20MB를 넘거나 삼각형이 12만 개를 넘어요.','외부 .bin 파일을 쓰는 GLTF, 점만 있는 PLY, 3D 데이터가 없는 HTML이에요.'],
      f:['Blender·MeshLab 등으로 지원 형식(OBJ·STL·GLB)으로 저장하세요.','폴리곤을 줄이세요 (Decimate).','GLTF는 GLB로 저장하세요.','오류 이유는 시뮬레이터 아래 작은 글씨로 나와요. 내용을 읽어 보세요.']},
    {t:'3D',q:'모델이 너무 작거나 크고, 누워 있거나 거꾸로예요',
      c:['파일의 단위를 자동으로 알 수 없어서 “모델 최대 길이”에 맞춰 크기를 정해요.','CAD 프로그램 모델은 Z축이 위쪽인 경우가 많아요.'],
      f:['“모델 최대 길이(mm)”에 실제 길이를 넣으세요.','“CAD 모델(Z축이 위쪽)”을 체크해 보세요.','“출구 아래 간격”으로 높이를 조절하세요.']},
    {t:'3D',q:'물이 모델을 그냥 통과해요',
      c:['“모델 표면 충돌 적용”이 꺼져 있어요.','모델이 물줄기 바로 아래에 있지 않아요.','모델 표면에 구멍이 있거나 열린 면이에요.'],
      f:['충돌 체크박스를 켜세요.','시점을 돌려 모델이 출구 바로 아래인지 확인하고 간격·길이를 조정하세요.','모델의 열린 면을 닫아서 다시 올려 보세요.']},
    {t:'계산',q:'절수율이 음수이거나 말이 안 돼요',
      c:['개선 출구 지름이 기존보다 크게 입력됐어요.','mL와 L, 초와 분 단위를 헷갈렸어요.','수도관 자체가 유량을 제한해서 지름 비율로 추정한 값이 실제와 달라요.'],
      f:['출구의 안쪽 지름(mm)을 다시 재세요.','받은 물은 mL, 시간은 초로 입력하세요.','개선품도 같은 방법으로 직접 재서 ③ 칸에 입력하세요.','같은 수도 개방 정도에서 3회 이상 재서 평균을 쓰세요.']},
    {t:'공유',q:'파일 업로드가 안 돼요',
      c:['20MB를 넘는 파일이에요. (이 공간의 최대치)','지원하지 않는 형식이에요. (ZIP, Word·Excel 등)','공동 저장 서버에 잠시 연결되지 않았어요.','공동 저장이 꺼진 보기예요.'],
      f:['파일을 줄이거나 나눠 올리세요.','STL·OBJ·PLY·OFF·GLB·GLTF·STEP·HTML·PDF·TXT·MD·CSV·JSON·이미지·영상으로 바꿔 올리세요.','잠시 후 새로고침해 보세요.','상단 상태 문구가 “공동 저장 연결됨”인지 확인하세요.']},
    {t:'공유',q:'올린 글·파일·실험로그가 목록에 바로 안 보여요',
      c:['실시간 연결이 잠깐 늦어졌어요.','일시적인 네트워크 문제예요.'],
      f:['몇 초 기다리면 자동으로 다시 불러와요. (6초마다 확인)','목록 위에 빨간 안내가 있으면 괄호 안 코드를 확인하세요.','그래도 안 되면 새로고침하세요.']},
    {t:'공유',q:'삭제가 안 돼요',
      c:['“삭제”를 누른 뒤 “정말 삭제”를 한 번 더 눌러야 해요.','다른 사람이 먼저 지워서 이미 없어진 글이에요.','공동 저장 서버에 잠시 연결되지 않았어요.'],
      f:['메시지·실험로그·공유 모델은 누구나 삭제할 수 있어요. 지우기 전에 한 번 더 확인하세요.','“삭제” 다음에 나오는 빨간 “정말 삭제”를 누르세요.','몇 초 기다리면 목록이 다시 불러와져요. 그래도 안 되면 새로고침하세요.','실패하면 “삭제하지 못했어요 (코드)” 문구의 코드를 알려 주세요.']},
    {t:'내려받기',q:'TXT·CSV·PDF·DOCX가 저장되지 않아요',
      c:['저장 허용 창에서 취소를 눌렀어요.','브라우저가 다운로드를 막고 있어요.','공동 저장이 꺼진 보기에서는 파일 저장 기능이 없어요.','아직 기록이 한 건도 없어요.'],
      f:['저장 창에서 “허용/저장”을 누르세요.','브라우저의 다운로드·팝업 차단을 해제하세요.','“파일 내용 보기”에서 내용을 복사해 쓰세요.','PDF는 이미지를 포함하느라 몇 초 걸릴 수 있어요.']},
    {t:'내려받기',q:'CSV를 엑셀에서 열면 한글이 깨져요',
      c:['엑셀이 글자 인코딩을 잘못 추정했어요.'],
      f:['엑셀 “데이터 → 텍스트/CSV에서 가져오기”에서 UTF-8을 선택하세요.','Google 스프레드시트로 열면 대부분 정상이에요.','한글이 중요하면 PDF나 DOCX를 쓰세요. “한글·Word용 DOCX”는 한글(HWP) 프로그램에서도 열려요.']},
    {t:'기록',q:'실험 기록 표의 숫자가 사라졌어요',
      c:['이 표는 이 브라우저에만 저장돼요. (기기 간 공유 안 됨)','시크릿 모드로 열었거나 브라우저 데이터를 지웠어요.'],
      f:['같은 기기·같은 브라우저에서 여세요.','“실험 기록 CSV 내려받기”로 자주 백업하세요.','공유할 기록은 멤버 공간의 “실험로그”에 올리세요.']},
    {t:'치수',q:'공동 치수를 저장했는데 다른 사람 화면은 안 바뀌어요',
      c:['공동 저장 서버에 연결되지 않은 상태예요.','상대 화면의 실시간 반영이 늦어졌어요.'],
      f:['저장 후 “공동 치수를 저장했어요” 문구가 나왔는지 확인하세요.','상대방이 새로고침하게 하세요.','상단 상태 문구가 “공동 저장 연결됨”인지 확인하세요.']},
    {t:'화면',q:'휴대폰에서 버튼이 겹치거나 너무 작아요',
      c:['화면이 좁아서 메뉴가 한 줄에 다 안 들어가요.'],
      f:['메뉴는 좌우로 밀어서 넘기세요.','휴대폰을 가로로 돌려 보세요.','브라우저 글자 크기·확대 비율을 기본(100%)으로 돌리세요.']},
    {t:'기타',q:'튜토리얼 창이 화면을 가려요',
      c:['튜토리얼 안내 창이 화면 아래에 떠 있어요.'],
      f:['Esc 키나 “닫기”를 누르세요.','“튜토리얼” 버튼을 다시 누르면 닫혀요.']}
  ];
  var back=document.getElementById('qaBack'),list=document.getElementById('qaList'),search=document.getElementById('qaSearch'),empty=document.getElementById('qaEmpty'),opener=null;
  function ul(arr){var u=document.createElement('ul');arr.forEach(function(x){var li=document.createElement('li');li.textContent=x;u.append(li)});return u}
  QA.forEach(function(it){
    var d=document.createElement('details'),sm=document.createElement('summary'),tag=document.createElement('span'),dl=document.createElement('dl');
    tag.className='tag';tag.textContent=it.t;sm.append(tag,document.createTextNode(it.q));
    var dt1=document.createElement('dt');dt1.className='c';dt1.textContent='원인';var dd1=document.createElement('dd');dd1.append(ul(it.c));
    var dt2=document.createElement('dt');dt2.className='f';dt2.textContent='해결 방법';var dd2=document.createElement('dd');dd2.append(ul(it.f));
    dl.append(dt1,dd1,dt2,dd2);d.append(sm,dl);d.dataset.s=(it.t+' '+it.q+' '+it.c.join(' ')+' '+it.f.join(' ')).toLowerCase();list.append(d);
  });
  function filter(){
    var q=search.value.trim().toLowerCase(),n=0;
    [].forEach.call(list.children,function(d){var ok=!q||d.dataset.s.indexOf(q)>-1;d.hidden=!ok;if(ok)n++;if(q&&ok&&n===1)d.open=true});
    empty.hidden=n>0;
  }
  search.addEventListener('input',filter);
  function open(){opener=document.activeElement;back.hidden=false;search.value='';filter();document.getElementById('qaClose').focus()}
  function close(){back.hidden=true;if(opener&&opener.focus)opener.focus()}
  document.getElementById('qaBtn').addEventListener('click',open);
  document.getElementById('qaClose').addEventListener('click',close);
  back.addEventListener('click',function(e){if(e.target===back)close()});
  document.addEventListener('keydown',function(e){if(!back.hidden&&e.key==='Escape')close()});
})();


/* ================= output slider ================= */
function updatePct(){
  var k=+$('#pctRange').value/100;FLOW.k=k;$('#pctVal').textContent=Math.round(k*100)+'%';
  $('#pctInfo').textContent=FLOW.q>0?(k===0?'수도가 잠겨 있어요. 물이 나오지 않아요.':'현재 출력 기준 개선 유량 약 '+(FLOW.q*k).toFixed(2)+' L/분 · '+(k<=.5?'가늘고 매끈한 층류형 물줄기':k<.8?'퍼지기 시작하는 전이 구간':'넓게 퍼지는 난류 물줄기')+' (실제 사진 기준)'):'수도를 얼마나 열었는지 조절해요.';
  $('#pctRange').setAttribute('aria-valuetext',Math.round(k*100)+'퍼센트');
  if(typeof drawVol==='function')drawVol();
}
$('#pctRange').addEventListener('input',updatePct);
['#qV','#qT','#dOld','#dNew','#qV2','#qT2'].forEach(function(x){$(x).addEventListener('input',updatePct)});
updatePct();

/* ================= login popup ================= */
var LG={started:false,shown:false};
function maybeLoginPopup(){
  if(LG.shown||!LG.started||!S.ready)return;
  var needLogin=S.mode!=='shared',readOnly=S.mode==='shared'&&!S.canWrite;
  if(!needLogin&&!readOnly)return;
  LG.shown=true;
  $('#lgTitle').textContent=needLogin?'공동 저장 서버에 연결하지 못했어요':'공동 저장은 지금 읽기 전용이에요';
  $('#lgText').textContent=needLogin?'지금은 공동 저장 서버에 연결할 수 없어서 글과 기록이 이 브라우저에만 저장돼요. 인터넷 연결을 확인하고 잠시 후 새로고침해 주세요.':'지금은 공동 저장된 내용을 볼 수만 있어요. 잠시 후 다시 시도해 주세요.';
    var b=$('#lgBack');b.hidden=false;$('#lgGo').focus();
}
function closeLoginPopup(){$('#lgBack').hidden=true}
$('#lgSkip').addEventListener('click',closeLoginPopup);
$('#lgGo').addEventListener('click',function(){location.reload()});
$('#lgBack').addEventListener('click',function(e){if(e.target===this)closeLoginPopup()});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('#lgBack').hidden)closeLoginPopup()});

/* ================= boot ================= */
renderFeed();renderModels();
(function(){
  Promise.all([useCap('db'),useCap('user'),useCap('downloads')]).then(function(r){
    S.db=r[0];S.dl=r[2];var u=r[1];
    var finish=function(can){
      if(S.db){S.mode='shared';S.canWrite=can!==false}
      S.ready=true;
      setTimeout(maybeLoginPopup,0);
      if(u&&u.isOwner){Promise.all([u.isOwner().catch(function(){return false}),u.canEdit?u.canEdit().catch(function(){return false}):false]).then(function(r){var a=!!(r[0]||r[1]);if(a!==S.admin){S.admin=a;renderFeed();renderModels();renderLogs()}})}
      setShareStatus();lockWrites();
      [startMessages,startModels,startDims,startLogs].forEach(function(fn){try{fn()}catch(err){console.error(err)}});
    };
    if(S.db&&u&&u.can){u.can('data.write').then(finish).catch(function(){finish(null)})}else finish(null);
  });
})();
setShareStatus();
})();

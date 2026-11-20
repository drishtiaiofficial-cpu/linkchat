(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
var D={name:'Jenny',logo:null,accent:null,jenny:true,links:true};
var ACC=[null,'#2F7D4F','#2F5F8F','#7B4FA0','#B3507A'];
var cur='Jenny',dirty=false,F={logo:null,accent:null},fab=$('fab'),fabO=fab?fab.innerHTML:'';
function msg(t,bad){var m=$('cuMsg');if(!m)return;m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function swap(root,from,to){
  if(!root||from===to)return;
  if(root.nodeType===3){if(root.nodeValue.indexOf(from)>-1)root.nodeValue=root.nodeValue.split(from).join(to);return}
  if(root.nodeType!==1)return;
  var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),n,L=[];
  while((n=w.nextNode()))if(n.nodeValue.indexOf(from)>-1)L.push(n);
  L.forEach(function(t){t.nodeValue=t.nodeValue.split(from).join(to)});
  var els=[root].concat(Array.prototype.slice.call(root.querySelectorAll('[aria-label],[placeholder],[title]')));
  els.forEach(function(e){['aria-label','placeholder','title'].forEach(function(a){var v=e.getAttribute(a);if(v&&v.indexOf(from)>-1)e.setAttribute(a,v.split(from).join(to))})});
}
['sheet','toast'].forEach(function(id){
  var el=$(id);if(!el)return;
  new MutationObserver(function(ms){if(cur==='Jenny')return;ms.forEach(function(m){m.addedNodes.forEach(function(n){swap(n,'Jenny',cur)})})}).observe(el,{childList:true,subtree:true});
});
function prev(){var p=$('cuPrev');if(!p)return;if(F.logo){p.src=F.logo;p.hidden=false}else{p.removeAttribute('src');p.hidden=true}
  document.querySelectorAll('.cuSw').forEach(function(b){b.setAttribute('aria-pressed',String((b.getAttribute('data-c')||'')===(F.accent||'')))})}
function fill(b){F.logo=b.logo||null;F.accent=b.accent||null;if($('cuName'))$('cuName').value=b.name||'Jenny';if($('cuJ'))$('cuJ').checked=b.jenny!==false;if($('cuL'))$('cuL').checked=b.links!==false;prev()}
function apply(b,doFill){
  var B=Object.assign({},D,b||{});
  var nm=String(B.name||'Jenny').trim().slice(0,20)||'Jenny';
  if(nm!==cur){swap(document.body,cur,nm);cur=nm}
  var av=document.querySelector('.sheet .avatar');
  if(av){
    if(/^data:image\//.test(B.logo||'')){av.textContent='';av.style.backgroundImage='url('+B.logo+')';av.style.backgroundSize='cover';av.style.backgroundPosition='center'}
    else{av.style.backgroundImage='';av.textContent=Array.from(nm)[0].toUpperCase()}
  }
  var r=document.documentElement.style;
  if(/^#[0-9a-fA-F]{6}$/.test(B.accent||''))r.setProperty('--tan',B.accent);else r.removeProperty('--tan');
  document.body.classList.toggle('x-jenny',B.jenny===false);
  document.body.classList.toggle('x-links',B.links===false);
  if(doFill)fill(B);
}
async function load(){
  var sb=window.LC_SB;if(!sb)return;
  try{var r=await sb.from('app_settings').select('value').eq('key','brand').maybeSingle();apply(r&&r.data?r.data.value:null,!dirty)}catch(e){}
}
function role(d){
  document.body.dataset.role=d.role;
  var n=({owner:'Owner',admin:'Admin',viewer:'Viewer'})[d.role]||d.role;
  ['rtag','hrole'].forEach(function(i){var e=$(i);if(e){e.textContent=n;e.hidden=false}});
}
var box=$('cuAcc');
if(box)ACC.forEach(function(c){var b=document.createElement('button');b.type='button';b.className='cuSw';b.setAttribute('data-c',c||'');b.setAttribute('aria-label','Colour '+(c||'default'));b.style.background=c||'#A66C42';b.onclick=function(){F.accent=c;dirty=true;prev()};box.appendChild(b)});
if($('cuCard')||$('custCard')){
  ['cuName','cuJ','cuL'].forEach(function(i){$(i).addEventListener('input',function(){dirty=true})});
  $('cuLogoBtn').onclick=function(){$('cuFile').click()};
  $('cuLogoClear').onclick=function(){F.logo=null;dirty=true;prev()};
  $('cuFile').onchange=function(){
    var f=this.files[0];if(!f)return;var im=new Image(),u=URL.createObjectURL(f);
    im.onload=function(){var c=document.createElement('canvas');c.width=c.height=192;var x=c.getContext('2d'),s=Math.min(im.width,im.height);
      x.drawImage(im,(im.width-s)/2,(im.height-s)/2,s,s,0,0,192,192);
      var d=c.toDataURL('image/png');if(d.length>150000)d=c.toDataURL('image/jpeg',0.8);
      F.logo=d;dirty=true;prev();URL.revokeObjectURL(u)};
    im.onerror=function(){msg('Image nahi khuli',true)};im.src=u;
  };
  $('cuSave').onclick=async function(){
    var sb=window.LC_SB;if(!sb)return;
    var v={name:$('cuName').value.trim().slice(0,20)||'Jenny',logo:F.logo,accent:F.accent,jenny:$('cuJ').checked,links:$('cuL').checked};
    msg('Save ho raha hai...');
    var r=await sb.from('app_settings').upsert({key:'brand',value:v,updated_at:new Date().toISOString()});
    if(r.error){msg(/app_settings|42P01/.test((r.error.message||'')+(r.error.code||''))?'Pehle SQL chalao (app_settings table)':'Error: '+r.error.message,true);return}
    dirty=false;apply(v,true);msg('Save ho gaya. Sabko dikhega.');
  };
}
window.addEventListener('lc-authed',function(e){role(e.detail);load()});
setInterval(function(){if(document.body.classList.contains('authed')&&!document.hidden)load()},60000);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&document.body.classList.contains('authed'))load()});
})();

(function(){
'use strict';
var C=window.LC_CONFIG||{},$=function(i){return document.getElementById(i)};
var KEY='lc_accts';
function qerr(){var s=(location.hash||'')+'&'+(location.search||''),m=/error_description=([^&]+)/.exec(s);return m?decodeURIComponent(m[1].replace(/\+/g,' ')):''}
var hErr=qerr();
var sb=window.supabase.createClient(C.url,C.key);window.LC_SB=sb;
var cool=0,busy=false,cur='',tmr=null,pend='',verifying=false,poll=null;
function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function store(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(e){return {}}}
function put(o){try{localStorage.setItem(KEY,JSON.stringify(o))}catch(e){}}
function save(s){if(!s||!s.user||!s.user.email)return;var o=store();o[s.user.email.toLowerCase()]={a:s.access_token,r:s.refresh_token,t:Date.now()};put(o)}
function msg(t,bad){var m=$('lgMsg');m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function fail(e){var t=(e&&e.message)||'';msg(e&&e.status===429?'Too many attempts. Please wait a minute and try again.':(/expired|invalid/i.test(t)?'That code is wrong or has expired. Please request a new one.':'Something went wrong: '+t),true)}
function show(w){$('lgIn').hidden=w!=='in';$('lgNo').hidden=w!=='no';if(w==='in'){$('lgS1').hidden=false;$('lgS2').hidden=true}}
function tick(){var b=$('lgResend');if(cool>0){b.disabled=true;b.textContent='Resend code in '+cool+'s';cool--;tmr=setTimeout(tick,1000)}else{b.disabled=false;b.textContent='Resend code'}}
function startCool(){clearTimeout(tmr);cool=60;tick()}
var boxes=Array.prototype.slice.call(document.querySelectorAll('#lgBoxes input'));
function code(){return boxes.map(function(b){return b.value}).join('')}
function clearBoxes(){boxes.forEach(function(b){b.value=''});boxes[0].focus()}
function fillFrom(i,str){var d=str.replace(/\D/g,'').split('');for(var k=0;k<d.length&&i+k<6;k++)boxes[i+k].value=d[k];boxes[Math.min(i+d.length,5)].focus();if(code().length===6)verify()}
boxes.forEach(function(b,i){
  b.addEventListener('input',function(){
    var v=b.value.replace(/\D/g,'');
    if(v.length>=4){b.value='';fillFrom(0,v);return}
    if(v.length>1)v=v.slice(-1);
    b.value=v;if(v&&i<5)boxes[i+1].focus();
    if(code().length===6)verify();
  });
  b.addEventListener('keydown',function(e){if(e.key==='Backspace'&&!b.value&&i>0){boxes[i-1].focus();boxes[i-1].value=''}});
  b.addEventListener('paste',function(e){var t=(e.clipboardData||window.clipboardData).getData('text');if(t){e.preventDefault();fillFrom(i,t)}});
});
async function sendTo(em){
  if(!/^\S+@\S+\.\S+$/.test(em)){msg('Enter a valid email address.',true);return}
  msg('Sending code…');$('lgSend').disabled=true;
  var r=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:location.origin}});
  $('lgSend').disabled=false;
  if(r.error){fail(r.error);if(r.error.status===429&&!$('lgS2').hidden)startCool();return}
  pend=em;$('lgTo').textContent=em;$('lgS1').hidden=true;$('lgS2').hidden=false;msg('');clearBoxes();startCool();
}
async function verify(){
  if(verifying)return;var t=code();if(t.length<6)return;
  verifying=true;msg('Verifying…');
  var r=await sb.auth.verifyOtp({email:pend,token:t,type:'email'});
  verifying=false;
  if(r.error){fail(r.error);clearBoxes()}
}
$('lgSend').onclick=function(){sendTo($('lgEmail').value.trim().toLowerCase())};
$('lgEmail').addEventListener('keydown',function(e){if(e.key==='Enter')$('lgSend').click()});
$('lgResend').onclick=function(){if(cool<=0)sendTo(pend)};
$('lgVerify').onclick=verify;
$('lgBack').onclick=function(){msg('');$('lgS2').hidden=true;$('lgS1').hidden=false};
$('lgCancel').onclick=function(){document.body.classList.remove('adding');msg('')};
$('lgGoogle').onclick=async function(){
  msg('Opening Google…');
  var r=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin,queryParams:{prompt:'select_account'}}});
  if(r.error)fail(r.error);
};
function chooser(){
  var k=Object.keys(store()),h='',el=$('lgAcc');
  k.forEach(function(e){h+='<button type="button" class="lgAcct" data-sw="'+esc(e)+'"><span class="lgAv">'+esc(e.charAt(0).toUpperCase())+'</span><span>'+esc(e)+'</span></button>'});
  el.hidden=!k.length;el.innerHTML=k.length?'<p class="lgSub">Continue as</p>'+h:'';
}
function renderDev(){
  var el=$('devAcc');if(!el)return;
  var k=Object.keys(store()),h='';
  k.forEach(function(e){var on=e===cur;
    h+='<div class="devRow"><span class="lgAv">'+esc(e.charAt(0).toUpperCase())+'</span><div class="admE">'+esc(e)+'<small>'+(on?'Active':'Saved on this device')+'</small></div>'+(on?'':'<button type="button" data-sw="'+esc(e)+'">Switch</button><button type="button" class="admDanger" data-rm="'+esc(e)+'">Hatao</button>')+'</div>'});
  el.innerHTML=h;var s2=$('swList');if(s2)s2.innerHTML=h;
}
async function switchTo(e){
  var o=store(),a=o[e];if(!a)return;
  msg('Switching…');
  var r=await sb.auth.setSession({access_token:a.a,refresh_token:a.r});
  if(r.error||!r.data||!r.data.session){delete o[e];put(o);msg('Session for '+e+' has expired. Please sign in again.',true);chooser();renderDev();return}
  document.body.classList.remove('adding');closeSw();
  await check(r.data.session);
}
function pick(ev){
  var s=ev.target.closest('[data-sw]'),r=ev.target.closest('[data-rm]');
  if(s)switchTo(s.getAttribute('data-sw'));
  else if(r){var o=store();delete o[r.getAttribute('data-rm')];put(o);renderDev();chooser()}
}
$('lgAcc').addEventListener('click',pick);
$('devAcc').addEventListener('click',pick);
function openSw(){renderDev();$('swSheet').classList.add('open');$('profBtn').setAttribute('aria-expanded','true')}
function closeSw(){var s=$('swSheet');if(s)s.classList.remove('open');var b=$('profBtn');if(b)b.setAttribute('aria-expanded','false')}
$('profBtn').onclick=openSw;$('swClose').onclick=closeSw;$('swScrim').onclick=closeSw;
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeSw()});
$('swList').addEventListener('click',pick);
$('swAdd').onclick=function(){closeSw();$('acAdd').click()};
$('swOut').onclick=function(){closeSw();$('acOut').click()};
$('acAdd').onclick=function(){document.body.classList.add('adding');show('in');msg('');chooser()};
async function denied(){
  var T=$('lgNoText'),H=$('lgNoH'),Q=$('lgReq');Q.hidden=true;
  var r=await sb.rpc('my_access_state'),st=r.error?'closed':r.data;
  var M={open:['Access required','This email is not on the access list. You can ask the owner for access.'],closed:['Access denied','This email is not on the LinkChat access list. Ask the owner to add you.'],pending:['Request sent','Waiting for the owner to approve. This page updates by itself.'],blocked:['Access blocked','The owner has blocked this email.'],off:['Access is off','Your access has been turned off by the owner.']};
  var m=M[st]||M.closed;H.textContent=m[0];T.textContent=m[1];Q.hidden=st!=='open';
  if(st==='pending'&&!poll)poll=setInterval(function(){sb.auth.getSession().then(function(x){if(x.data&&x.data.session)check(x.data.session)})},15000);
  if(st!=='pending'){clearInterval(poll);poll=null}
}
$('lgReq').onclick=async function(){var q=$('lgReq');q.disabled=true;await sb.rpc('request_access');q.disabled=false;denied()};
async function check(s){
  if(s&&document.body.classList.contains('adding')&&String((s.user&&s.user.email)||'').toLowerCase()===cur)return;
  if(busy)return;busy=true;
  try{
    var b=document.body.classList;
    if(!s){clearInterval(poll);poll=null;try{localStorage.removeItem('lc_was')}catch(e){}b.remove('authed');b.remove('adding');document.body.dataset.role='';cur='';show('in');chooser();if(hErr){msg(hErr,true);hErr=''}return}
    var r=await sb.from('admins').select('email,role,status'),em=String((s.user&&s.user.email)||'').toLowerCase(),d=(r.data||[]).find(function(x){return String(x.email).toLowerCase()===em})||null;
    if(r.error||!d||d.status!=='active'){try{localStorage.removeItem('lc_was')}catch(e){}b.remove('authed');b.remove('adding');show('no');$('lgNoMail').textContent=em;await denied();return}
    clearInterval(poll);poll=null;cur=em;save(s);var pa=$('profAv');if(pa)pa.textContent=em.charAt(0).toUpperCase();
    $('acEmail').textContent=d.email;$('acRole').textContent=d.role;
    b.remove('adding');b.add('authed');try{localStorage.setItem('lc_was','1');localStorage.setItem('lc_role',d.role)}catch(e){}
    if(location.hash||location.search)history.replaceState(null,'',location.pathname);
    window.dispatchEvent(new CustomEvent('lc-authed',{detail:d}));renderDev();
  }catch(e){fail(e)}finally{busy=false}
}
sb.auth.onAuthStateChange(function(ev,s){
  if(ev==='TOKEN_REFRESHED'){if(s)setTimeout(function(){var e=String((s.user&&s.user.email)||'').toLowerCase();if(store()[e])save(s)},0);return}
  setTimeout(function(){check(s)},0);
});
async function outLocal(){var o=store(),e=cur||String($('lgNoMail').textContent||'').toLowerCase();if(e){delete o[e];put(o)}await sb.auth.signOut({scope:'local'})}
$('acOut').onclick=outLocal;$('lgNoOut').onclick=outLocal;
$('acOutAll').onclick=async function(){var o=store();if(cur){delete o[cur];put(o)}await sb.auth.signOut({scope:'global'})};
})();

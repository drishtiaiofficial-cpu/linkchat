(function(){
'use strict';
var C=window.LC_CONFIG||{},$=function(i){return document.getElementById(i)};
var hErr=(/error_description=([^&]+)/.exec(location.hash)||[])[1];
var sb=window.supabase.createClient(C.url,C.key);window.LC_SB=sb;
var cool=0,busy=false;
function msg(t,bad){var m=$('lgMsg');m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function fail(e){msg(e&&e.status===429?'Bahut jaldi-jaldi try hua. Thoda ruk kar dobara karo.':'Error: '+((e&&e.message)||'unknown'),true)}
function tick(){var b=$('lgSend');if(cool>0){b.disabled=true;b.textContent='Dobara ('+cool+'s)';cool--;setTimeout(tick,1000)}else{b.disabled=false;b.textContent='Code bhejo'}}
function mail(){return $('lgEmail').value.trim().toLowerCase()}
$('lgSend').onclick=async function(){
  var em=mail();if(!/^\S+@\S+\.\S+$/.test(em)){msg('Sahi email daalo',true);return}
  msg('Bhej raha hoon...');
  var r=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:location.origin}});
  if(r.error){fail(r.error);return}
  $('lgS2').hidden=false;msg('Email check karo: code aayega (ya link).');cool=60;tick();
};
$('lgVerify').onclick=async function(){
  var t=$('lgCode').value.replace(/\D/g,'');if(t.length<6){msg('Poora code daalo',true);return}
  msg('Check kar raha hoon...');
  var r=await sb.auth.verifyOtp({email:mail(),token:t,type:'email'});
  if(r.error)fail(r.error);
};
async function check(s){
  if(busy)return;busy=true;
  try{
    var b=document.body.classList;
    if(!s){b.remove('authed');document.body.dataset.role='';$('lgIn').hidden=false;$('lgNo').hidden=true;if(hErr)msg(decodeURIComponent(hErr.replace(/\+/g,' ')),true);return}
    var r=await sb.from('admins').select('email,role,status'),em=((s.user&&s.user.email)||'').toLowerCase(),d=(r.data||[]).find(function(x){return String(x.email).toLowerCase()===em})||null;
    if(r.error||!d||d.status!=='active'){b.remove('authed');$('lgIn').hidden=true;$('lgNo').hidden=false;$('lgNoMail').textContent=(s.user&&s.user.email)||'';return}
    $('acEmail').textContent=d.email;$('acRole').textContent=d.role;b.add('authed');window.dispatchEvent(new CustomEvent('lc-authed',{detail:d}));
  }catch(e){fail(e)}finally{busy=false}
}
sb.auth.onAuthStateChange(function(ev,s){if(ev==='TOKEN_REFRESHED')return;setTimeout(function(){check(s)},0)});
function out(sc){return function(){sb.auth.signOut({scope:sc})}}
$('acOut').onclick=out('local');$('acOutAll').onclick=out('global');$('lgNoOut').onclick=out('local');
})();

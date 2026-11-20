(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function msg(t,bad){var m=$('admMsg');if(!m)return;m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function nice(e){var t=((e&&e.message)||'')+' '+((e&&e.code)||'');
  if(/23505/.test(t))return 'Ye email pehle se list mein hai';
  if(/42501|policy/.test(t))return 'Pehle SQL chalao (admins policies)';
  if(/23514|check/.test(t))return 'DB ne value reject ki, ye error bhejo: '+t;
  return 'Error: '+((e&&e.message)||'unknown')}
async function load(){
  var sb=window.LC_SB;if(!sb)return;
  var r=await sb.from('admins').select('email,role,status,created_at').order('created_at',{ascending:true});
  if(r.error){msg(nice(r.error),true);return}
  var h='';
  (r.data||[]).forEach(function(a){
    var e=esc(a.email),on=a.status==='active';
    if(a.role==='owner'){h+='<div class="admRow"><div class="admE">'+e+'<small>Owner &middot; lock</small></div></div>';return}
    h+='<div class="admRow" data-e="'+e+'"><div class="admE">'+e+'<small>'+(on?'Access ON':'Access OFF')+'</small></div>'
     +'<select data-act="role" aria-label="Role"><option value="admin"'+(a.role==='admin'?' selected':'')+'>Admin</option><option value="viewer"'+(a.role==='viewer'?' selected':'')+'>Viewer</option></select>'
     +'<button type="button" data-act="tog">'+(on?'OFF karo':'ON karo')+'</button><button type="button" class="admDanger" data-act="del">Hatao</button></div>';
  });
  $('admList').innerHTML=h||'<p>Abhi koi admin nahi.</p>';
}
async function done(r){if(r&&r.error)msg(nice(r.error),true);else msg('Ho gaya');load()}
$('admList').addEventListener('click',async function(ev){
  var b=ev.target.closest('button[data-act]');if(!b)return;
  var em=b.closest('.admRow').getAttribute('data-e'),sb=window.LC_SB,r;
  if(b.getAttribute('data-act')==='tog'){r=await sb.from('admins').update({status:b.textContent==='ON karo'?'active':'disabled'}).eq('email',em)}
  else{if(!confirm(em+' ko hata dein?'))return;r=await sb.from('admins').delete().eq('email',em)}
  done(r);
});
$('admList').addEventListener('change',async function(ev){
  var s=ev.target.closest('select[data-act="role"]');if(!s)return;
  done(await window.LC_SB.from('admins').update({role:s.value}).eq('email',s.closest('.admRow').getAttribute('data-e')));
});
$('admAdd').onclick=async function(){
  var em=$('admEmail').value.trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(em)){msg('Sahi email daalo',true);return}
  var r=await window.LC_SB.from('admins').insert({email:em,role:$('admRole').value,status:'active'});
  if(r.error){msg(nice(r.error),true);return}
  $('admEmail').value='';msg('Add ho gaya');load();
};
$('admKill').onclick=async function(){
  if(!confirm('Owner ko chhod kar SABKA access band karein?'))return;
  done(await window.LC_SB.from('admins').update({status:'disabled'}).neq('role','owner'));
};
async function watch(){
  var sb=window.LC_SB;if(!sb||!document.body.classList.contains('authed')||document.hidden)return;
  try{
    var u=(await sb.auth.getUser()).data.user,em=((u&&u.email)||'').toLowerCase();
    var r=await sb.from('admins').select('email,status');
    if(r.error)return;
    var me=(r.data||[]).find(function(x){return String(x.email).toLowerCase()===em});
    if(!me||me.status!=='active')sb.auth.signOut();
  }catch(e){}
}
window.addEventListener('lc-authed',function(e){if(e.detail&&e.detail.role==='owner')load()});
setInterval(watch,60000);
})();

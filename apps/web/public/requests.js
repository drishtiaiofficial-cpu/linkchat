(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function msg(t,bad){var m=$('reqMsg');if(!m)return;m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function fd(x){try{return new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}catch(e){return ''}}
async function load(){
  var sb=window.LC_SB;if(!sb||document.body.dataset.role!=='owner')return;
  var q=await Promise.all([sb.from('access_requests').select('email,status,created_at,decided_at').order('created_at',{ascending:false}),sb.from('app_settings').select('value').eq('key','access').maybeSingle()]);
  if(q[0].error){msg('Pehle SQL chalao (access_requests)',true);return}
  var P=[],B=[];(q[0].data||[]).forEach(function(r){(r.status==='blocked'?B:P).push(r)});
  $('reqN').textContent=P.length?'('+P.length+' pending)':'';
  $('reqOn').checked=!!(q[1].data&&q[1].data.value&&q[1].data.value.requests===true);
  var h='';
  P.forEach(function(r){var e=esc(r.email);h+='<div class="admRow" data-e="'+e+'"><div class="admE">'+e+'<small>Requested '+esc(fd(r.created_at))+'</small></div><select data-r aria-label="Role"><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button type="button" data-a="approve">Approve</button><button type="button" class="admDanger" data-a="block">Reject</button></div>'});
  $('reqList').innerHTML=h||'<p>Koi pending request nahi.</p>';
  h='';
  B.forEach(function(r){var e=esc(r.email);h+='<div class="admRow" data-e="'+e+'"><div class="admE">'+e+'<small>Blocked '+esc(fd(r.decided_at||r.created_at))+'</small></div><button type="button" data-a="unblock">Unblock</button></div>'});
  $('blkList').innerHTML=h||'<p>Koi blocked nahi.</p>';
}
$('reqCard').addEventListener('click',async function(ev){
  var b=ev.target.closest('button[data-a]');if(!b)return;
  var row=b.closest('.admRow'),em=row.getAttribute('data-e'),a=b.getAttribute('data-a'),sel=row.querySelector('select');
  if(a==='block'&&!confirm(em+' ko reject karke block karein?'))return;
  var r=await window.LC_SB.rpc('decide_request',{p_email:em,p_action:a,p_role:sel?sel.value:'viewer'});
  if(r.error){msg('Error: '+r.error.message,true);return}
  msg(a==='approve'?'Approve ho gaya':(a==='block'?'Block ho gaya':'Unblock ho gaya'));
  window.dispatchEvent(new CustomEvent('lc-refresh-admins'));load();
});
$('reqOn').onchange=async function(){
  var on=this.checked,r=await window.LC_SB.from('app_settings').upsert({key:'access',value:{requests:on},updated_at:new Date().toISOString()});
  if(r.error){msg('Error: '+r.error.message,true);this.checked=!on}else msg(on?'Requests ON':'Requests OFF');
};
window.addEventListener('lc-authed',load);
setInterval(function(){if(document.body.classList.contains('authed')&&!document.hidden)load()},30000);
})();

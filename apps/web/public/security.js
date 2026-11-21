(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function msg(t,bad){var m=$('secMsg');if(!m)return;m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function when(x){try{return new Date(x).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}}
var K={request_flood:'Request flood',test:'Test alert'};
async function load(){
  var sb=window.LC_SB;if(!sb||document.body.dataset.role!=='owner'||document.hidden)return;
  var r=await sb.from('security_events').select('id,at,kind,email,detail,status').order('at',{ascending:false}).limit(30);
  if(r.error){$('secList').innerHTML='<p>Pehle SQL chalao (security_events)</p>';return}
  var d=r.data||[],open=d.filter(function(x){return x.status==='open'}),h='';
  $('secN').textContent=open.length?'('+open.length+' naya)':'';
  d.forEach(function(a){
    var on=a.status==='open';
    h+='<div class="admRow'+(on?'':' secDone')+'"><div class="admE">'+esc(K[a.kind]||a.kind)+(a.email?' <b>'+esc(a.email)+'</b>':'')+'<small>'+esc(a.detail||'')+' &middot; '+esc(when(a.at))+(on?'':' &middot; '+esc(a.status==='blocked'?'Block kiya':'Allow kiya'))+'</small></div>'
     +(on?'<button type="button" data-id="'+a.id+'" data-a="allow">'+(a.email?'Allow':'Theek hai')+'</button>'+(a.email?'<button type="button" class="admDanger" data-id="'+a.id+'" data-a="block">Block</button>':''):'')+'</div>';
  });
  $('secList').innerHTML=h||'<p>Sab shaant hai. Koi alert nahi.</p>';
}
$('secCard').addEventListener('click',async function(ev){
  var sb=window.LC_SB,t=ev.target.closest('#secTest');
  if(t){var q=await sb.rpc('make_test_event');if(q.error)msg('Error: '+q.error.message,true);else{msg('Test alert ban gaya');load()}return}
  var b=ev.target.closest('button[data-a]');if(!b)return;
  if(b.getAttribute('data-a')==='block'&&!confirm('Is email ko block karein?'))return;
  var r=await sb.rpc('decide_event',{p_id:Number(b.getAttribute('data-id')),p_action:b.getAttribute('data-a')});
  if(r.error){msg('Error: '+r.error.message,true);return}
  msg('Ho gaya');window.dispatchEvent(new CustomEvent('lc-refresh-admins'));load();
});
window.addEventListener('lc-authed',load);
setInterval(function(){if(document.body.classList.contains('authed'))load()},20000);
})();

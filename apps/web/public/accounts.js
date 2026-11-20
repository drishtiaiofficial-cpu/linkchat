(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function msg(t,bad){var m=$('accMsg');if(!m)return;m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function st(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function nice(e){var t=((e&&e.message)||'')+' '+((e&&e.code)||'');
  if(/42P01/.test(t))return 'Pehle SQL chalao (accounts table)';
  if(/23505/.test(t))return 'Ye account pehle se hai';
  if(/23514/.test(t))return 'Handle: sirf a-z, 0-9, . aur _ (max 30)';
  return 'Error: '+((e&&e.message)||'unknown')}
var A=[],act=null;
function cur(){return A.find(function(a){return a.id===act})||null}
function tell(){window.dispatchEvent(new CustomEvent('lc-account',{detail:cur()}))}
function render(){
  var h='';
  A.forEach(function(a){h+='<button type="button" class="chip" data-id="'+a.id+'" aria-pressed="'+(a.id===act)+'">@'+esc(a.handle)+(a.status==='pending'?' <small>baaki</small>':'')+'</button>'});
  $('accChips').innerHTML=h||'<p>Abhi koi account nahi. Owner account add karega.</p>';
}
async function loadAccess(){
  var sb=window.LC_SB;
  var q=await Promise.all([sb.from('account_access').select('account_id,email'),sb.from('admins').select('email,role,status').neq('role','owner')]);
  if(q[0].error||q[1].error)return;
  var M={};(q[0].data||[]).forEach(function(x){(M[x.account_id]=M[x.account_id]||{})[x.email]=1});
  var U=q[1].data||[],h='';
  A.forEach(function(a){
    h+='<details class="accD" data-id="'+a.id+'"><summary>@'+esc(a.handle)+' <small>'+(a.status==='pending'?'Meta connect baaki':esc(a.status))+'</small></summary>';
    U.forEach(function(u){var e=String(u.email).toLowerCase();h+='<label class="cuT"><input type="checkbox" data-e="'+esc(e)+'"'+((M[a.id]||{})[e]?' checked':'')+'> '+esc(e)+'</label>'});
    if(!U.length)h+='<p>Pehle Settings mein admin add karo.</p>';
    h+='<button type="button" class="abtn alt admDanger" data-del="'+a.id+'">Account hatao</button></details>';
  });
  $('accAdmin').innerHTML=h;
}
async function load(){
  var sb=window.LC_SB;if(!sb)return;
  var r=await sb.from('accounts').select('id,handle,label,status').order('handle');
  if(r.error){msg(nice(r.error),true);return}
  A=r.data||[];
  if(!cur()){act=st('lc_active');if(!cur())act=A.length?A[0].id:null}
  $('accCount').textContent=A.length;
  render();tell();
  if(document.body.dataset.role==='owner')await loadAccess();
}
$('accChips').addEventListener('click',function(ev){
  var b=ev.target.closest('.chip');if(!b)return;
  act=b.getAttribute('data-id');st('lc_active',act);render();tell();
});
$('accAdd').onclick=async function(){
  var h=$('accHandle').value.trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9._]{1,30}$/.test(h)){msg('Handle: sirf a-z, 0-9, . aur _',true);return}
  var r=await window.LC_SB.from('accounts').insert({handle:h});
  if(r.error){msg(nice(r.error),true);return}
  $('accHandle').value='';msg('Add ho gaya');load();
};
$('accAdmin').addEventListener('change',async function(ev){
  var c=ev.target.closest('input[type=checkbox]');if(!c)return;
  var id=c.closest('details').getAttribute('data-id'),e=c.getAttribute('data-e'),t=window.LC_SB.from('account_access'),r;
  r=c.checked?await t.insert({account_id:id,email:e}):await t.delete().eq('account_id',id).eq('email',e);
  if(r.error){msg(nice(r.error),true);c.checked=!c.checked}else msg('Ho gaya');
});
$('accAdmin').addEventListener('click',async function(ev){
  var b=ev.target.closest('[data-del]');if(!b)return;
  if(!confirm('Ye account hata dein?'))return;
  var r=await window.LC_SB.from('accounts').delete().eq('id',b.getAttribute('data-del'));
  if(r.error)msg(nice(r.error),true);else{msg('Hata diya');load()}
});
window.addEventListener('lc-authed',load);
setInterval(function(){if(document.body.classList.contains('authed')&&!document.hidden&&document.body.dataset.role!=='owner')load()},60000);
})();

(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var L={
 'admins.INSERT':'Admin add hua','admins.UPDATE':'Admin badla','admins.DELETE':'Admin hataya gaya',
 'access_requests.INSERT':'Access request aayi','access_requests.UPDATE':'Request ka status badla','access_requests.DELETE':'Request poori hui',
 'app_settings.INSERT':'Setting bani','app_settings.UPDATE':'Setting badli','app_settings.DELETE':'Setting hati',
 'accounts.INSERT':'Account add hua','accounts.UPDATE':'Account badla','accounts.DELETE':'Account hataya gaya',
 'account_access.INSERT':'Account access diya','account_access.DELETE':'Account access hataya','account_access.UPDATE':'Account access badla'
};
function when(x){try{return new Date(x).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}}
async function load(){
  var sb=window.LC_SB;if(!sb||document.body.dataset.role!=='owner'||document.hidden)return;
  var r=await sb.from('audit_log').select('at,actor,action,target,detail').order('at',{ascending:false}).limit(60);
  if(r.error){$('actList').innerHTML='<p>Pehle SQL chalao (audit_log)</p>';return}
  var h='';
  (r.data||[]).forEach(function(a){
    var d=a.detail||{},x=[];
    if(d.role)x.push(d.role);if(d.status)x.push(d.status);
    h+='<div class="actRow"><div class="actT">'+esc(L[a.action]||a.action)+(a.target?' <b>'+esc(a.target)+'</b>':'')+(x.length?' <small>('+esc(x.join(', '))+')</small>':'')+'</div><small>'+esc(when(a.at))+' &middot; '+esc(a.actor||'')+'</small></div>';
  });
  $('actList').innerHTML=h||'<p>Abhi koi activity nahi.</p>';
}
window.addEventListener('lc-authed',load);
window.addEventListener('lc-refresh-admins',function(){setTimeout(load,600)});
setInterval(function(){if(document.body.classList.contains('authed'))load()},30000);
})();

(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
var A=null,last='',PRE=[15,20,60,300,900,2400];
function role(){return document.body.dataset.role||''}
function canFast(){return role()==='owner'}
function fmt(s){if(s<60)return s+' sec';if(s<3600)return (Math.round(s/6)/10)+' min';return (Math.round(s/360)/10)+' h'}
function msg(t,bad){var m=$('gapMsg');m.textContent=t||'';m.style.color=bad?'var(--red)':'var(--muted)'}
function nice(e){var t=(e&&e.message)||'';return /set_gap|42883/.test(t+(e&&e.code||''))?'Run the SQL first (set_gap)':(t||'Error')}
function fill(g){if(g>=60&&g%60===0){$('gapVal').value=g/60;$('gapUnit').value='60'}else{$('gapVal').value=g;$('gapUnit').value='1'}}
function render(){
  var c=$('gapCard'),r=role();
  if(!A||!r){c.hidden=true;return}
  c.hidden=false;
  var g=A.gap_seconds||20;
  $('gapWho').textContent='@'+A.handle;
  $('gapNow').textContent='Now: one DM every '+fmt(g)+' (about '+Math.floor(19*3600/g)+' per day, quiet hours excluded)';
  var h='';
  PRE.forEach(function(s){var off=(!canFast()&&s<g)||r==='viewer';h+='<button type="button" class="chip" data-s="'+s+'"'+(off?' disabled':'')+' aria-pressed="'+(s===g)+'">'+fmt(s)+(s===15?' (floor)':'')+'</button>'});
  $('gapChips').innerHTML=h;
  ['gapVal','gapUnit','gapSave'].forEach(function(i){$(i).disabled=(r==='viewer')});
  $('gapNote').textContent=r==='owner'?'You can slow down or speed up. Never below 15 sec.':(r==='admin'?'Admins can only slow down. Only the owner can speed up.':'View only.');
  var k=A.id+':'+g;if(k!==last){last=k;fill(g)}
}
$('gapChips').addEventListener('click',function(ev){var b=ev.target.closest('button[data-s]');if(!b||b.disabled)return;fill(Number(b.getAttribute('data-s')))});
$('gapSave').onclick=async function(){
  var v=Number($('gapVal').value),u=Number($('gapUnit').value),s=Math.round(v*u),g=(A&&A.gap_seconds)||20;
  if(!A)return;
  if(!isFinite(s)||s<15||s>7200){msg('Enter 15 seconds to 2 hours.',true);return}
  if(s<g&&!canFast()){msg('Only the owner can speed up.',true);return}
  if(s<20&&!confirm('Faster than the 20 sec default raises the risk. Continue?'))return;
  if(s>600&&!confirm('Very slow: a big backlog may not finish inside the 7-day reply window. Continue?'))return;
  msg('Saving...');
  var r=await window.LC_SB.rpc('set_gap',{p_account:A.id,p_seconds:s});
  if(r.error){msg(nice(r.error),true);return}
  A.gap_seconds=r.data;msg('Saved. One DM every '+fmt(s)+'.');render();
  window.dispatchEvent(new CustomEvent('lc-reload-accounts'));
};
window.addEventListener('lc-account',function(e){A=e.detail||null;render()});
})();

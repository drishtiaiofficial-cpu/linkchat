(function(){
'use strict';
var el=document.getElementById('ptr'),sy=0,d=0,on=false,busy=false;
if(!el)return;
function top(){return (document.scrollingElement||document.documentElement).scrollTop<=0}
function skip(t){return t.closest&&t.closest('.sheet,.swBox,#actList,#msgs,input,textarea,select')}
document.addEventListener('touchstart',function(e){
  if(busy||e.touches.length!==1||!document.body.classList.contains('authed')||!top()||skip(e.target)||document.querySelector('#sheet.open,#swSheet.open')){on=false;return}
  sy=e.touches[0].clientY;d=0;on=true;
},{passive:true});
document.addEventListener('touchmove',function(e){
  if(!on)return;
  var dy=e.touches[0].clientY-sy;
  if(dy<=0||!top()){d=0;el.style.opacity=0;return}
  d=Math.min(dy*0.5,90);
  el.style.transition='none';el.style.opacity=Math.min(1,d/50);
  el.style.transform='translateY('+(d-50)+'px) rotate('+(d*4)+'deg)';
},{passive:true});
async function run(){
  busy=true;el.classList.add('spin');
  el.style.transition='transform .2s,opacity .2s';el.style.transform='translateY(14px)';el.style.opacity=1;
  var t0=Date.now();
  try{
    var sb=window.LC_SB;if(sb)await sb.auth.getSession();
    var r=document.body.dataset.role;
    if(r)window.dispatchEvent(new CustomEvent('lc-authed',{detail:{role:r}}));
  }catch(x){}
  await new Promise(function(f){setTimeout(f,Math.max(0,800-(Date.now()-t0)))});
  el.classList.remove('spin');el.style.opacity=0;el.style.transform='translateY(-60px)';busy=false;
}
function end(){
  if(!on)return;on=false;
  if(d>=60)run();else{el.style.transition='transform .2s,opacity .2s';el.style.opacity=0;el.style.transform='translateY(-60px)'}
  d=0;
}
document.addEventListener('touchend',end,{passive:true});
document.addEventListener('touchcancel',end,{passive:true});
})();

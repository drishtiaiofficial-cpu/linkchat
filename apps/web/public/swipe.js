(function(){
'use strict';
var sh=document.getElementById('sheet'),cl=document.getElementById('close');
if(!sh||!cl)return;
var g=null;
function side(){return sh.getBoundingClientRect().height>=window.innerHeight-2}
sh.addEventListener('touchstart',function(e){
  if(!sh.classList.contains('open')||e.touches.length!==1)return;
  var t=e.target,sd=side();
  if(t.closest('input,textarea,button,a,select'))return;
  if(!sd&&!t.closest('.sh-head'))return;
  var p=e.touches[0];g={x:p.clientX,y:p.clientY,t:Date.now(),side:sd,on:false,d:0};
},{passive:true});
sh.addEventListener('touchmove',function(e){
  if(!g)return;
  var p=e.touches[0],dx=p.clientX-g.x,dy=p.clientY-g.y;
  if(!g.on){
    if(Math.abs(dx)<10&&Math.abs(dy)<10)return;
    var ok=g.side?(dx>0&&Math.abs(dx)>Math.abs(dy)*1.5):(dy>0&&Math.abs(dy)>Math.abs(dx)*1.5);
    if(!ok){g=null;return}
    g.on=true;sh.style.transition='none';
  }
  g.d=Math.max(0,g.side?dx:dy);
  sh.style.transform=g.side?'translateX('+g.d+'px)':'translateY('+g.d+'px)';
},{passive:true});
function end(){
  if(!g)return;
  var G=g;g=null;if(!G.on)return;
  var size=G.side?sh.offsetWidth:sh.offsetHeight,v=G.d/Math.max(1,Date.now()-G.t);
  var shut=G.d>Math.max(110,size*0.3)||(G.d>60&&v>0.6);
  sh.style.transition='';
  if(shut){
    sh.style.transform=G.side?'translateX(105%)':'translateY(105%)';
    cl.click();
    setTimeout(function(){sh.style.transform=''},450);
  }else sh.style.transform='';
}
sh.addEventListener('touchend',end,{passive:true});
sh.addEventListener('touchcancel',end,{passive:true});
})();

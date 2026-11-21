(function(){
'use strict';
var sh=document.getElementById('sheet'),msgs=document.getElementById('msgs'),grab=document.getElementById('grab');
if(!sh||!msgs)return;
function phone(){return window.matchMedia('(max-width:699px)').matches}
function full(on){sh.classList.toggle('full',on)}
if(grab)grab.addEventListener('click',function(){if(phone())full(!sh.classList.contains('full'))});
var y0=null;
sh.addEventListener('touchstart',function(e){
  y0=(phone()&&e.touches.length===1&&e.target.closest('.grab,.sh-head')&&!e.target.closest('button'))?e.touches[0].clientY:null;
},{passive:true});
sh.addEventListener('touchend',function(e){
  if(y0===null)return;
  var dy=e.changedTouches[0].clientY-y0;y0=null;
  if(dy<-40)full(true);else if(dy>40&&sh.classList.contains('full'))full(false);
},{passive:true});
new MutationObserver(function(){if(!sh.classList.contains('open'))full(false)}).observe(sh,{attributes:true,attributeFilter:['class']});
var tp=null,tt=null;
function hideT(){clearTimeout(tt);if(tp&&tp.parentNode)tp.parentNode.removeChild(tp);tp=null}
new MutationObserver(function(ms){
  ms.forEach(function(m){Array.prototype.forEach.call(m.addedNodes,function(n){
    if(!n.classList||!n.classList.contains('msg')||n.classList.contains('typing'))return;
    if(n.classList.contains('me')){
      hideT();tp=document.createElement('div');tp.className='msg typing';tp.setAttribute('aria-label','typing');tp.innerHTML='<i></i><i></i><i></i>';
      msgs.appendChild(tp);msgs.scrollTop=msgs.scrollHeight;tt=setTimeout(hideT,5000);
    }else hideT();
  })});
}).observe(msgs,{childList:true});
})();

(function(){
'use strict';
var sh=document.getElementById('sheet'),sc=document.getElementById('scrim'),cl=document.getElementById('close'),sw=document.getElementById('swSheet');
if(!sh)return;
function sync(){document.body.classList.toggle('modal-open',sh.classList.contains('open')||!!(sw&&sw.classList.contains('open')))}
new MutationObserver(sync).observe(sh,{attributes:true,attributeFilter:['class']});
if(sw)new MutationObserver(sync).observe(sw,{attributes:true,attributeFilter:['class']});
if(sc){
  sc.addEventListener('click',function(){if(sh.classList.contains('open')&&cl)cl.click()});
  sc.addEventListener('touchmove',function(e){e.preventDefault()},{passive:false});
}
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&sh.classList.contains('open')&&cl)cl.click()});
})();

(function(){
'use strict';
var sh=document.getElementById('sheet'),ex=document.getElementById('expand');
if(sh&&ex)ex.addEventListener('click',function(){sh.classList.toggle('full')});
})();

const socket = io({transports:['websocket','polling']});
const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
let me = null, state = null, myPalette = {body:'#7b6d5f',head:'#9b7651',arm:'#7b6d5f',leg:'#514a43'};
const target = {x:600,y:350};
let renderPlayers = new Map();

$('joinBtn').onclick = () => socket.emit('join',{roomCode:$('room').value,name:$('name').value});
socket.on('joinError', m => $('joinError').textContent=m);
socket.on('joined', ({roomCode}) => { $('lobby').classList.add('hidden'); $('waiting').classList.remove('hidden'); $('roomCodeText').textContent=roomCode; });
$('startBtn').onclick = () => socket.emit('start');

socket.on('state', s => {
  state=s;
  if (s.phase!=='waiting') { $('waiting').classList.add('hidden'); $('game').classList.remove('hidden'); }
  const self=s.players.find(p=>p.id===socket.id); if(self){me=self;myPalette=self.palette;}
  $('round').textContent=s.round; $('time').textContent=s.timeLeft+'초';
  $('phaseText').textContent = s.phase==='hide'?'숨기':s.phase==='seek'?'찾기':s.phase==='result'?'결과':'대기';
  $('roster').innerHTML=s.players.map(p=>`<div class="playerChip">${p.name}${p.id===s.seekerId?' 🔎':''}${p.role==='caught'?' ✅':''}</div>`).join('');
  if(s.phase==='hide' && me?.role!=='seeker'){ $('paintTools').classList.remove('hidden'); $('seekTools').classList.add('hidden'); $('roleTitle').textContent='숨는 사람'; $('roleDesc').textContent='명화 색과 비슷하게 칠한 뒤 구석에 숨어보세요.'; }
  else if(s.phase==='seek' && me?.role==='seeker'){ $('seekTools').classList.remove('hidden'); $('paintTools').classList.add('hidden'); $('roleTitle').textContent='술래'; $('roleDesc').textContent='맵을 돌아다니며 숨은 사람을 찾아보세요.'; }
  else if(s.phase==='result'){ $('paintTools').classList.add('hidden');$('seekTools').classList.add('hidden');$('roleTitle').textContent='라운드 종료';$('roleDesc').textContent='결과를 확인하세요.'; }
  s.players.forEach(p=>renderPlayers.set(p.id,{...p}));
  draw();
});
socket.on('playerMove', p => { const x=renderPlayers.get(p.id)||{}; renderPlayers.set(p.id,{...x,...p}); });
socket.on('caught', ({targetId}) => toast('잡혔어요!'));
socket.on('miss', () => toast('아직 너무 멀어요.'));
socket.on('painted', ({palette}) => {myPalette=palette;toast('색칠했어요.');draw()});

$('paintBtn').onclick=()=>socket.emit('paint',{part:$('part').value,color:$('color').value});

function toast(t){$('toast').textContent=t;setTimeout(()=>{$('toast').textContent=''},1200)}
function sendMove(){ if(!me||!state||!['hide','seek'].includes(state.phase))return; socket.emit('move',{x:me.x,y:me.y,rotation:me.rotation||0}); }
window.addEventListener('keydown',e=>{
  if(!me||!state||!['hide','seek'].includes(state.phase))return;
  const step=18; let moved=false;
  if(e.key==='ArrowLeft'||e.key==='a'){me.x-=step;me.rotation=Math.PI;moved=true}
  if(e.key==='ArrowRight'||e.key==='d'){me.x+=step;me.rotation=0;moved=true}
  if(e.key==='ArrowUp'||e.key==='w'){me.y-=step;me.rotation=-Math.PI/2;moved=true}
  if(e.key==='ArrowDown'||e.key==='s'){me.y+=step;me.rotation=Math.PI/2;moved=true}
  me.x=Math.max(35,Math.min(1165,me.x));me.y=Math.max(45,Math.min(655,me.y));
  if(moved){sendMove();draw();}
});
canvas.addEventListener('pointerdown',e=>{
 const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height;
 if(me && state?.phase==='seek' && me.role==='seeker'){
   let best=null,bd=1e9; for(const p of state.players){if(p.id===me.id||p.role==='caught')continue;const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p;}}
   if(best && bd<60)socket.emit('catchAttempt',{targetId:best.id});
 }
});

function draw(){
 ctx.clearRect(0,0,canvas.width,canvas.height);
 drawPainting();
 if(!state)return;
 for(const p of state.players){
   if(p.id!==socket.id && state.phase!=='result' && p.id!==state.seekerId && state.phase==='seek' && p.role==='hider'){
      // Hiders remain visible in this first draft; later we can add hiding/occlusion rules.
   }
   drawPerson(p);
 }
}
function drawPainting(){
 // Original painterly palette inspired by classic night landscapes; no external artwork used in this prototype.
 ctx.fillStyle='#d9c8a7';ctx.fillRect(0,0,1200,700);
 ctx.fillStyle='#7c8060';ctx.fillRect(0,470,1200,230);
 // swirly sky bands
 for(let i=0;i<8;i++){
   ctx.strokeStyle=['#3d5263','#52697a','#73816c','#b7a46a','#7a6a63'][i%5];ctx.lineWidth=42;ctx.beginPath();
   ctx.arc(150+i*155,140+(i%2)*35,110,Math.PI*0.1,Math.PI*1.3);ctx.stroke();
 }
 // buildings / landmarks
 [[80,390,180,80],[310,410,170,60],[560,380,210,90],[850,400,220,70],[1050,350,90,120]].forEach((a,i)=>{ctx.fillStyle=['#735f51','#8c7659','#5f6a57','#806c5c','#6b645b'][i];ctx.fillRect(...a)});
 // trees
 for(const [x,y] of [[230,420],[760,430],[980,470]]){ctx.fillStyle='#4d4a35';ctx.fillRect(x-8,y,16,90);ctx.fillStyle='#3f5b45';ctx.beginPath();ctx.arc(x,y-10,50,0,Math.PI*2);ctx.fill();}
 // small objects
 for(const [x,y] of [[430,520],[690,515],[890,550]]){ctx.fillStyle='#9b8b71';ctx.fillRect(x,y,55,32);ctx.fillStyle='#756755';ctx.fillRect(x+8,y-8,39,10)}
 // pathway
 ctx.fillStyle='#b9a98d';ctx.beginPath();ctx.moveTo(0,560);ctx.quadraticCurveTo(450,480,820,590);ctx.quadraticCurveTo(1040,650,1200,520);ctx.lineTo(1200,700);ctx.lineTo(0,700);ctx.closePath();ctx.fill();
}
function drawPerson(p){
 const x=p.x,y=p.y;const pal=p.id===socket.id?myPalette:(p.palette||myPalette);
 ctx.save();ctx.translate(x,y);ctx.rotate(p.rotation||0);
 // shadow
 ctx.fillStyle='#0002';ctx.beginPath();ctx.ellipse(0,24,25,9,0,0,Math.PI*2);ctx.fill();
 // legs
 ctx.fillStyle=pal.leg||'#514a43';ctx.fillRect(-12,10,9,24);ctx.fillRect(3,10,9,24);
 // body
 ctx.fillStyle=pal.body||'#7b6d5f';roundRect(-17,-13,34,30,8);ctx.fill();
 // arms
 ctx.strokeStyle=pal.arm||pal.body||'#7b6d5f';ctx.lineWidth=9;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-13,-6);ctx.lineTo(-27,8);ctx.moveTo(13,-6);ctx.lineTo(27,8);ctx.stroke();
 // head
 ctx.fillStyle=pal.head||'#9b7651';ctx.beginPath();ctx.arc(0,-24,13,0,Math.PI*2);ctx.fill();
 ctx.restore();
}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
setInterval(()=>draw(),100);

const socket = io();
const $ = (id) => document.getElementById(id);
const lobby = $('lobby'), host = $('host'), game = $('game');
const gameCanvas = $('gameCanvas'), ctx = gameCanvas.getContext('2d', { alpha: false });
const hostCanvas = $('hostCanvas'), hctx = hostCanvas.getContext('2d', { alpha: false });
let state = null, me = null, isHost = false;
let camera = {x:0,y:0}, moveVec = {x:0,y:0}, painting = false;
let paintMode = false, eyedropperMode = false, lastMove = 0, scanFX = [];
const renderPlayers = new Map();

$('hostBtn').onclick = () => socket.emit('host', { code: $('adminCode').value });
$('joinBtn').onclick = () => socket.emit('join', { roomCode: $('room').value, name: $('name').value });
$('copyCodeBtn').onclick = async () => { try{ await navigator.clipboard?.writeText($('hostRoomCode').textContent.trim()); }catch{} $('hostStatus').textContent='방 코드를 복사했어요.'; };
$('hostStartBtn').onclick = () => socket.emit('start');
$('hostRestartBtn').onclick = () => socket.emit('restart');
$('saveSettings').onclick = () => socket.emit('settings', {
  mapId: $('mapSelect').value,
  hideSeconds: $('hideSeconds').value, seekSeconds: $('seekSeconds').value,
  baseScanSeconds: $('baseScanSeconds').value, finalScanSeconds: $('finalScanSeconds').value,
  finalScanWindowSeconds: $('finalScanWindowSeconds').value, scanRadius: $('scanRadius').value,
  revealSeconds: $('revealSeconds').value
});

socket.on('hostReady', ({roomCode}) => { isHost=true; lobby.classList.add('hidden'); host.classList.remove('hidden'); $('hostRoomCode').textContent=roomCode; });
socket.on('joined', ({roomCode}) => { isHost=false; lobby.classList.add('hidden'); game.classList.remove('hidden'); $('room').value=roomCode; resize(); });
socket.on('hostError', msg => $('joinError').textContent=msg);
socket.on('joinError', msg => $('joinError').textContent=msg);
socket.on('roomClosed', () => location.reload());
socket.on('scanEffect', fx => { scanFX.push({...fx, started: performance.now()}); if (fx.found?.length) setStatus(`${fx.found.length}명 감지!`); else setStatus('탐지 펄스'); });
socket.on('caught', ({name}) => setStatus(`${name} 학생을 찾았어요`));
socket.on('scanDenied', ({waitMs}) => setStatus(`다음 탐지까지 ${(waitMs/1000).toFixed(1)}초`));
socket.on('catchDenied', msg => setStatus(msg));

socket.on('state', (s) => {
  state=s;
  if (isHost) { renderHost(); return; }
  me=s.players.find(p=>p.id===socket.id) || null;
  for (const p of s.players) renderPlayers.set(p.id,p);
  for (const id of [...renderPlayers.keys()]) if (!s.players.some(p=>p.id===id)) renderPlayers.delete(id);
  renderUI();
  resize();
});

function renderUI(){
  if(!state)return;
  const phaseName={waiting:'대기',hide:'숨기',seek:'찾기',result:'결과'}[state.phase]||'';
  $('phaseLabel').textContent=phaseName;
  $('timer').textContent=fmt(state.timeLeft);
  $('roleLabel').textContent=me?.role==='hider'?'숨는 사람':me?.role==='seeker'?'찾는 사람':'';
  const canPaint=me?.role==='hider'&&state.phase==='hide';
  const canMove=me && ((me.role==='hider'&&state.phase==='hide')||(me.role==='seeker'&&state.phase==='seek'));
  $('paintTools').classList.toggle('hidden',!canPaint);
  $('seekTools').classList.toggle('hidden',!(me?.role==='seeker'&&state.phase==='seek'));
  $('joystick').classList.toggle('hidden',!canMove);
  $('scanText').textContent=me?.role==='seeker'?`탐지 간격 ${state.scanCooldown}초`:'';
  if(state.phase==='result') showResult(); else $('resultBox').classList.add('hidden');
}
function showResult(){
  const alive=state.players.filter(p=>p.role==='hider'&&p.alive).map(p=>p.name);
  $('resultBox').innerHTML=`<h2>라운드 종료</h2><p>끝까지 숨어 있던 사람</p><div class="big">${alive.length?escapeHtml(alive.join(', ')):'없음'}</div>`;
  $('resultBox').classList.remove('hidden');
}
function fmt(n){const m=Math.floor(n/60),s=Math.max(0,n%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function setStatus(m){$('status').textContent=m;clearTimeout(setStatus.t);setStatus.t=setTimeout(()=>{$('status').textContent=''},1400)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function resize(){
  if(game.classList.contains('hidden'))return;
  const dpr=Math.min(1.5,window.devicePixelRatio||1),w=innerWidth,h=innerHeight;
  gameCanvas.width=Math.floor(w*dpr);gameCanvas.height=Math.floor(h*dpr);gameCanvas.style.width=w+'px';gameCanvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);render();
}
window.addEventListener('resize',resize);

function drawWorld(g, map){
  g.save();
  g.fillStyle='#b6aa8c';g.fillRect(0,0,map.width,map.height);
  if(map.id==='monalisa') drawMonaMap(g,map); else drawClassicMap(g,map);
  g.restore();
}
function drawClassicMap(g,map){
  const zones=[[160,160,1800,1250,'#6f8567'],[2200,150,2200,1250,'#8e6b61'],[4680,180,2820,1200,'#b89966'],[170,1650,1950,2150,'#6f8790'],[2380,1570,2150,2300,'#8d826f'],[4800,1520,2600,2380,'#776e87'],[280,4040,7200,500,'#8b8273']];
  for(const [x,y,w,h,col] of zones){g.fillStyle=col;roundRect(g,x,y,w,h,60)}
  g.lineWidth=190;g.lineCap='round';g.strokeStyle='#eadfc2';
  const roads=[[[80,1320],[1200,1240],[2400,1350],[3900,1320],[5400,1280],[7520,1380]],[[1650,90],[1900,950],[2150,1700],[2050,3000],[1820,4700]],[[4200,90],[4050,800],[4250,1550],[4100,2950],[4220,4700]],[[240,3200],[1500,3040],[2850,3160],[4300,3000],[6000,3120],[7520,3060]]];
  for(const pts of roads){g.beginPath();g.moveTo(...pts[0]);for(let i=1;i<pts.length;i++)g.lineTo(...pts[i]);g.stroke()}
  const objects=[[550,550,150,'#4f5b49'],[1240,870,120,'#53694f'],[2740,500,150,'#5b4b46'],[3530,710,140,'#755a4a'],[5600,600,160,'#7e6a51'],[6870,690,135,'#6a5e58'],[710,2350,160,'#506c6d'],[1500,2470,135,'#4c6555'],[3060,2190,175,'#655b54'],[5480,2250,160,'#606170'],[6650,2500,135,'#6f5d73'],[1120,3530,140,'#65574e'],[2600,4010,160,'#596950'],[3940,3740,145,'#665b54'],[6180,3860,170,'#586a69']];
  for(const [x,y,r,col] of objects){g.fillStyle=col;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill()}
  g.strokeStyle='#514b43';g.lineWidth=24;g.strokeRect(18,18,map.width-36,map.height-36);
  g.font='bold 50px system-ui';g.fillStyle='#4e463c';g.fillText('오리지널 명화풍 테스트 맵',120,map.height-110);
}
function drawMonaMap(g,map){
  // 갤러리 바닥
  g.fillStyle='#b8a887';g.fillRect(0,0,map.width,map.height);
  // 큰 중앙 명화 벽
  g.fillStyle='#6e5b45';roundRect(g,650,430,6700,3600,80);
  g.fillStyle='#d6c8a8';roundRect(g,760,540,6480,3380,55);
  // 모나리자 패널: 업로드된 원본을 비율을 유지해 크게 확대
  const img=MonaLisaImage;
  if(img.complete&&img.naturalWidth){
    const panelW=1480,panelH=2940; const px=(map.width-panelW)/2,py=760;
    g.fillStyle='#3b2f22';g.fillRect(px-35,py-35,panelW+70,panelH+70);
    containImage(g,img,px,py,panelW,panelH);
  }
  // 그림 주변의 넓은 색면/전시벽
  const panels=[
    [1100,900,1050,680,'#667056'],[5850,920,950,720,'#82705f'],
    [1120,1750,980,850,'#8a6f59'],[5920,1780,900,860,'#687a80'],
    [1080,2860,1080,700,'#7d735d'],[5870,2870,980,690,'#6e665b']
  ];
  for(const [x,y,w,h,col] of panels){g.fillStyle=col;roundRect(g,x,y,w,h,36)}
  // 통로와 장애물
  g.fillStyle='#e4d8bb';roundRect(g,120,420,480,3650,40);roundRect(g,7400,420,480,3650,40);
  g.fillStyle='#957f63';roundRect(g,150,4250,7700,620,45);
  const props=[[1050,4400,190,130,'#4d6450'],[1680,4400,160,160,'#745f50'],[6900,4420,220,120,'#596c68'],[7350,4400,150,160,'#6a5b51'],[420,880,100,420,'#5b6f55'],[7400,1050,120,400,'#6e6253']];
  for(const [x,y,w,h,col] of props){g.fillStyle=col;roundRect(g,x,y,w,h,25)}
  g.strokeStyle='#4f483e';g.lineWidth=26;g.strokeRect(20,20,map.width-40,map.height-40);
  g.font='bold 52px system-ui';g.fillStyle='#4c443a';g.fillText('모나리자 갤러리 · Mona Lisa',120,5090);
}
const MonaLisaImage=new Image();MonaLisaImage.src='/assets/mona-lisa.png';
function containImage(g,img,x,y,w,h){const scale=Math.min(w/img.naturalWidth,h/img.naturalHeight);const dw=img.naturalWidth*scale,dh=img.naturalHeight*scale;g.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh)}
function roundRect(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();g.fill()}

function cameraTarget(){
  if(me && ((me.role==='hider'&&state?.phase==='hide')||(me.role==='seeker'&&state?.phase==='seek'))) return {x:me.x,y:me.y};
  return {x:(state?.map.width||8000)/2,y:(state?.map.height||5200)/2};
}
function updateCamera(){
  if(!state)return;
  const t=cameraTarget();
  const halfW=innerWidth/2,halfH=innerHeight/2;
  // 캐릭터/시점 중심을 정확히 화면 한가운데 유지
  camera.x=Math.max(halfW,Math.min(state.map.width-halfW,t.x));
  camera.y=Math.max(halfH,Math.min(state.map.height-halfH,t.y));
}
function worldToScreen(x,y){return{x:x-camera.x+innerWidth/2,y:y-camera.y+innerHeight/2}}
function screenToWorld(sx,sy){return{x:sx-innerWidth/2+camera.x,y:sy-innerHeight/2+camera.y}}

function render(){
  if(!state||isHost)return;
  updateCamera();
  ctx.clearRect(0,0,innerWidth,innerHeight);
  ctx.save();ctx.translate(innerWidth/2-camera.x,innerHeight/2-camera.y);drawWorld(ctx,state.map);ctx.restore();
  drawPlayers();drawEffects();
}
function visibleToMe(p){
  if(p.role==='hider'&&state.phase==='seek'&&p.id!==socket.id){return p.revealUntil&&Date.now()<p.revealUntil}
  return true;
}

function humanPath(g,pose){
  // 업로드된 흰색 사람 모양을 참고한 단일 실루엣: 머리/몸을 나누지 않고 한 번에 색칠
  g.beginPath();
  if(pose==='stand'){
    g.moveTo(-22,-92);g.arc(0,-124,32,0,Math.PI*2); // head
    g.moveTo(-25,-92);g.quadraticCurveTo(-68,-62,-88,-25);g.quadraticCurveTo(-96,-8,-83,4);g.quadraticCurveTo(-70,10,-54,-3);g.lineTo(-30,-22);g.lineTo(-58,30);g.lineTo(-112,6);g.quadraticCurveTo(-126,0,-132,12);g.quadraticCurveTo(-135,23,-120,31);g.lineTo(-44,69);g.lineTo(-28,50);g.lineTo(-42,125);g.lineTo(-12,125);g.lineTo(0,62);g.lineTo(15,125);g.lineTo(45,125);g.lineTo(30,50);g.lineTo(48,69);g.lineTo(118,30);g.quadraticCurveTo(132,22,127,9);g.quadraticCurveTo(122,-3,109,2);g.lineTo(54,31);g.lineTo(28,-22);g.lineTo(54,-3);g.quadraticCurveTo(72,10,84,2);g.quadraticCurveTo(96,-8,88,-25);g.quadraticCurveTo(67,-62,25,-92);g.closePath();
  } else if(pose==='crouch'){
    g.moveTo(-24,-45);g.arc(0,-74,31,0,Math.PI*2);
    g.moveTo(-24,-44);g.quadraticCurveTo(-74,-30,-96,-2);g.lineTo(-131,-30);g.quadraticCurveTo(-146,-37,-154,-23);g.quadraticCurveTo(-159,-9,-143,-1);g.lineTo(-87,27);g.lineTo(-50,18);g.lineTo(-5,50);g.lineTo(-75,77);g.lineTo(-110,109);g.quadraticCurveTo(-118,122,-105,128);g.quadraticCurveTo(-96,132,-87,124);g.lineTo(-53,96);g.lineTo(10,70);g.lineTo(45,86);g.lineTo(80,120);g.quadraticCurveTo(90,130,100,121);g.quadraticCurveTo(109,112,99,102);g.lineTo(66,67);g.lineTo(36,47);g.lineTo(58,23);g.lineTo(87,37);g.quadraticCurveTo(102,44,109,30);g.quadraticCurveTo(115,17,101,10);g.lineTo(48,-16);g.lineTo(27,-44);g.closePath();
  } else {
    // 옆으로 눕기
    g.moveTo(-75,-30);g.arc(-45,-58,29,0,Math.PI*2);
    g.moveTo(-21,-36);g.quadraticCurveTo(18,-53,60,-37);g.lineTo(102,-20);g.quadraticCurveTo(116,-14,110,-1);g.quadraticCurveTo(104,11,91,7);g.lineTo(50,-6);g.lineTo(78,25);g.quadraticCurveTo(90,37,78,46);g.quadraticCurveTo(67,54,56,43);g.lineTo(29,18);g.lineTo(0,48);g.lineTo(-33,78);g.quadraticCurveTo(-44,89,-54,79);g.quadraticCurveTo(-64,68,-52,58);g.lineTo(-15,23);g.lineTo(-55,14);g.lineTo(-91,33);g.quadraticCurveTo(-105,40,-112,27);g.quadraticCurveTo(-118,14,-103,7);g.lineTo(-61,-12);g.closePath();
  }
}
function drawPlayer(p,targetCtx=ctx,offset=camera,scale=1,showLabel=false){
  if(targetCtx===ctx && !visibleToMe(p))return;
  const sp={x:p.x-offset.x,y:p.y-offset.y};
  targetCtx.save();targetCtx.translate(sp.x,sp.y);targetCtx.rotate(p.rotation||0);targetCtx.scale(scale,scale);
  // 흰 바탕 + 전체 몸 하나의 클리핑 영역
  targetCtx.save();humanPath(targetCtx,p.pose);targetCtx.clip();targetCtx.fillStyle='#f4f2e9';targetCtx.fill();
  for(const st of p.paint||[]){targetCtx.fillStyle=st.color;targetCtx.beginPath();targetCtx.arc(st.x,st.y,st.radius,0,Math.PI*2);targetCtx.fill()}
  targetCtx.restore();
  // 1px 검은 외곽선
  targetCtx.strokeStyle='#111';targetCtx.lineWidth=1;humanPath(targetCtx,p.pose);targetCtx.stroke();
  if(p.role==='seeker'&&targetCtx===hctx){targetCtx.strokeStyle='#ff9a6a';targetCtx.lineWidth=5;targetCtx.beginPath();targetCtx.arc(0,-25,42,0,Math.PI*2);targetCtx.stroke()}
  if(p.revealUntil&&Date.now()<p.revealUntil&&p.role==='hider'&&targetCtx===ctx){targetCtx.strokeStyle='#fff';targetCtx.lineWidth=4;targetCtx.beginPath();targetCtx.arc(0,0,150,0,Math.PI*2);targetCtx.stroke()}
  if(showLabel){targetCtx.fillStyle='#111d';targetCtx.font='bold 18px system-ui';targetCtx.textAlign='center';targetCtx.fillText(p.name,0,-160)}
  targetCtx.restore();
}
function drawPlayers(){
  for(const p of [...renderPlayers.values()].filter(p=>p.alive).sort((a,b)=>a.y-b.y))drawPlayer(p,ctx,camera,1,p.id===socket.id);
}
function drawEffects(){
  const now=performance.now();scanFX=scanFX.filter(f=>now-f.started<1050);
  for(const f of scanFX){
    const t=Math.min(1,(now-f.started)/700),s=worldToScreen(f.x,f.y),r=40+Math.min(innerWidth,innerHeight)*.15*t;
    ctx.save();ctx.globalAlpha=1-t*.85;ctx.lineWidth=8;
    const grad=ctx.createRadialGradient(s.x,s.y,2,s.x,s.y,r);grad.addColorStop(0,'#fff');grad.addColorStop(.25,'#ff4da6');grad.addColorStop(.48,'#ffd12e');grad.addColorStop(.70,'#38e6ff');grad.addColorStop(.88,'#735cff');grad.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(s.x,s.y,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#fff';ctx.globalAlpha=.75-t*.65;ctx.beginPath();ctx.arc(s.x,s.y,r*.9,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  if(me?.role==='seeker'&&state.phase==='seek'){ctx.strokeStyle='#fff9';ctx.lineWidth=2;ctx.beginPath();ctx.arc(innerWidth/2,innerHeight/2,10,0,Math.PI*2);ctx.moveTo(innerWidth/2-18,innerHeight/2);ctx.lineTo(innerWidth/2+18,innerHeight/2);ctx.moveTo(innerWidth/2,innerHeight/2-18);ctx.lineTo(innerWidth/2,innerHeight/2+18);ctx.stroke()}
}

function pointerWorld(e){const r=gameCanvas.getBoundingClientRect();return screenToWorld(e.clientX-r.left,e.clientY-r.top)}
function bodyLocalFromPointer(e){const w=pointerWorld(e);const dx=w.x-me.x,dy=w.y-me.y;const a=-(me.rotation||0),x=dx*Math.cos(a)-dy*Math.sin(a),y=dx*Math.sin(a)+dy*Math.cos(a);return{x,y}}

gameCanvas.addEventListener('pointerdown',e=>{
  if(!state||!me||state.phase==='waiting'||state.phase==='result')return;
  if(me.role==='hider'&&state.phase==='hide'){
    if(e.target===gameCanvas && eyedropperMode){
      const r=gameCanvas.getBoundingClientRect();const sx=e.clientX-r.left,sy=e.clientY-r.top;
      const px=ctx.getImageData(Math.floor(sx),Math.floor(sy),1,1).data;
      const hex='#'+[0,1,2].map(i=>px[i].toString(16).padStart(2,'0')).join('');$('color').value=hex;eyedropperMode=false;updateToolButtons();setStatus('맵에서 색을 골랐어요');return;
    }
    if(paintMode){const local=bodyLocalFromPointer(e);if(withinApproxBody(local.x,local.y,me.pose)){painting=true;gameCanvas.setPointerCapture(e.pointerId);paintAtLocal(local.x,local.y)}}
  } else if(me.role==='seeker'&&state.phase==='seek'){
    const w=pointerWorld(e);socket.emit('scan',{x:w.x,y:w.y});
  }
});
gameCanvas.addEventListener('pointermove',e=>{if(!painting||!me)return;const local=bodyLocalFromPointer(e);paintAtLocal(local.x,local.y)});
gameCanvas.addEventListener('pointerup',()=>painting=false);gameCanvas.addEventListener('pointercancel',()=>painting=false);
function paintAtLocal(x,y){if(!withinApproxBody(x,y,me.pose))return;socket.emit('paint',{x,y,radius:Number($('brushSize').value)||18,color:$('color').value})}
function withinApproxBody(x,y,pose){if(pose==='lay')return ((x+5)*(x+5))/(122*122)+((y+3)*(y+3))/(70*70)<1.1; if(pose==='crouch')return ((x)*(x))/(150*150)+((y+20)*(y+20))/(145*145)<1.05; return ((x)*(x))/(132*132)+((y+2)*(y+2))/(140*140)<1.05}
$('paintToggle').onclick=()=>{paintMode=!paintMode;eyedropperMode=false;updateToolButtons()};
$('eyedropperToggle').onclick=()=>{eyedropperMode=!eyedropperMode;paintMode=false;updateToolButtons()};
function updateToolButtons(){$('paintToggle').classList.toggle('active',paintMode);$('eyedropperToggle').classList.toggle('active',eyedropperMode)}
document.querySelectorAll('.poseButtons button').forEach(b=>b.onclick=()=>socket.emit('pose',{pose:b.dataset.pose}));

let keyState={x:0,y:0};
window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){e.preventDefault();if(k==='w'||k==='arrowup')keyState.y=-1;if(k==='s'||k==='arrowdown')keyState.y=1;if(k==='a'||k==='arrowleft')keyState.x=-1;if(k==='d'||k==='arrowright')keyState.x=1;moveVec={...keyState}}});
window.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){if(k==='w'||k==='arrowup'||k==='s'||k==='arrowdown')keyState.y=0;if(k==='a'||k==='arrowleft'||k==='d'||k==='arrowright')keyState.x=0;moveVec={...keyState}}});

const joy=$('joystick'),stick=joy.querySelector('.stick');let joyActive=false;
function setJoy(e){const r=joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width/2-25,dx=e.clientX-cx,dy=e.clientY-cy,len=Math.min(max,Math.hypot(dx,dy));const a=Math.atan2(dy,dx);const x=Math.cos(a)*len,y=Math.sin(a)*len;stick.style.transform=`translate(${x}px,${y}px)`;moveVec={x:x/max,y:y/max}}
joy.addEventListener('pointerdown',e=>{joyActive=true;joy.setPointerCapture(e.pointerId);setJoy(e)});joy.addEventListener('pointermove',e=>{if(joyActive)setJoy(e)});
function resetJoy(){joyActive=false;stick.style.transform='translate(0,0)';moveVec={x:0,y:0}}
joy.addEventListener('pointerup',resetJoy);joy.addEventListener('pointercancel',resetJoy);

setInterval(()=>{
  if(!me||!state)return;
  const moving=(me.role==='hider'&&state.phase==='hide')||(me.role==='seeker'&&state.phase==='seek');
  if(!moving||!me.alive)return;
  const len=Math.hypot(moveVec.x,moveVec.y);if(len<.05)return;
  const map=state.map,speed=me.role==='seeker'?5.2:4.8;
  me.x=Math.max(60,Math.min(map.width-60,me.x+moveVec.x*speed*6));me.y=Math.max(60,Math.min(map.height-60,me.y+moveVec.y*speed*6));
  if(len>.1)me.rotation=Math.atan2(moveVec.y,moveVec.x);
  const now=performance.now();if(now-lastMove>70){socket.emit('move',{x:me.x,y:me.y,rotation:me.rotation});lastMove=now}
},40);
setInterval(render,50);

function renderHost(){
  if(state.settings){for(const id of ['hideSeconds','seekSeconds','baseScanSeconds','finalScanSeconds','finalScanWindowSeconds','scanRadius','revealSeconds'])if(document.activeElement?.id!==id)$(id).value=state.settings[id]; if(document.activeElement?.id!=='mapSelect')$('mapSelect').value=state.settings.mapId}
  $('hostStartBtn').disabled=state.phase!=='waiting'||state.players.length<2;
  renderHostRoster();renderHostCanvas();
}
function renderHostRoster(){
  $('hostStatus').textContent=`현재 ${state.players.length}/20명 · 술래 ${state.seekerCount}명 · 숨는 사람 ${state.hiderCount}명 · 상태 ${({waiting:'대기실',hide:'숨기',seek:'찾기',result:'결과'})[state.phase]}`;
  $('hostRoster').innerHTML=state.players.map(p=>`<div class="rosterItem"><span>${escapeHtml(p.name)}</span><span class="role-${p.role}">${p.role==='seeker'?'술래':p.role==='hider'?'숨는 사람':'대기'}</span></div>`).join('');
}
function renderHostCanvas(){
  const w=hostCanvas.clientWidth||1100,h=hostCanvas.clientHeight||700,dpr=Math.min(1.5,devicePixelRatio||1);
  hostCanvas.width=Math.floor(w*dpr);hostCanvas.height=Math.floor(h*dpr);hctx.setTransform(dpr,0,0,dpr,0,0);
  const scale=Math.min((w-20)/state.map.width,(h-20)/state.map.height),ox=(w-state.map.width*scale)/2,oy=(h-state.map.height*scale)/2;
  hctx.save();hctx.translate(ox,oy);hctx.scale(scale,scale);drawWorld(hctx,state.map);for(const p of state.players.filter(p=>p.alive))drawPlayer(p,hctx,{x:0,y:0},1,true);hctx.restore();
}

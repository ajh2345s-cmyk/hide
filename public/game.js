const socket = io();
const $ = (id) => document.getElementById(id);
const lobby = $('lobby'), host = $('host'), game = $('game');
const gameCanvas = $('gameCanvas'), ctx = gameCanvas.getContext('2d');
const hostCanvas = $('hostCanvas'), hctx = hostCanvas.getContext('2d');
let state = null, me = null, isHost = false, camera = {x:0,y:0}, moveVec = {x:0,y:0};
let paintMode = false, eyedropperMode = false, painting = false, lastMove = 0;
let scanFX = [];
const renderPlayers = new Map();

$('hostBtn').onclick = () => socket.emit('host', { code: $('adminCode').value });
$('joinBtn').onclick = () => socket.emit('join', { roomCode: $('room').value, name: $('name').value });
$('copyCodeBtn').onclick = async () => { await navigator.clipboard?.writeText($('hostRoomCode').textContent.trim()); $('hostStatus').textContent='방 코드를 복사했어요.'; };
$('hostStartBtn').onclick = () => socket.emit('start');
$('hostRestartBtn').onclick = () => socket.emit('restart');
$('saveSettings').onclick = () => socket.emit('settings', {
  hideSeconds: $('hideSeconds').value, seekSeconds: $('seekSeconds').value,
  baseScanSeconds: $('baseScanSeconds').value, finalScanSeconds: $('finalScanSeconds').value,
  finalScanWindowSeconds: $('finalScanWindowSeconds').value, scanRadius: $('scanRadius').value, revealSeconds: $('revealSeconds').value
});

socket.on('hostReady', ({roomCode}) => { isHost = true; lobby.classList.add('hidden'); host.classList.remove('hidden'); $('hostRoomCode').textContent = roomCode; });
socket.on('joined', ({roomCode}) => { isHost = false; lobby.classList.add('hidden'); game.classList.remove('hidden'); $('room').value = roomCode; resize(); });
socket.on('hostError', msg => $('joinError').textContent = msg);
socket.on('joinError', msg => $('joinError').textContent = msg);
socket.on('roomClosed', () => location.reload());
socket.on('scanEffect', fx => { scanFX.push({...fx, started: performance.now()}); setStatus(fx.found?.length ? `${fx.found.length}명 감지!` : '탐지 펄스'); });
socket.on('caught', ({name}) => setStatus(`${name} 학생을 찾았어요`));
socket.on('scanDenied', ({waitMs}) => setStatus(`다음 탐지까지 ${(waitMs/1000).toFixed(1)}초`));
socket.on('catchDenied', msg => setStatus(msg));

socket.on('state', (s) => {
  state = s;
  if (isHost) { renderHost(); return; }
  const p = s.players.find(p => p.id === socket.id);
  if (p) { me = p; renderPlayers.set(p.id, p); }
  for (const p of s.players) renderPlayers.set(p.id, p);
  for (const id of [...renderPlayers.keys()]) if (!s.players.some(p=>p.id===id)) renderPlayers.delete(id);
  renderUI();
  resize();
});

function renderUI(){
  if (!state) return;
  const phaseName = {waiting:'대기',hide:'숨기',seek:'찾기',result:'결과'}[state.phase] || '';
  $('phaseLabel').textContent = phaseName;
  $('timer').textContent = fmt(state.timeLeft);
  $('roleLabel').textContent = me ? (me.role==='hider'?'숨는 사람':me.role==='seeker'?'찾는 사람':'') : '';
  $('paintTools').classList.toggle('hidden', !(me?.role==='hider' && state.phase==='hide'));
  $('seekTools').classList.toggle('hidden', !(me?.role==='seeker' && state.phase==='seek'));
  $('scanText').textContent = me?.role==='seeker' ? `탐지 간격 ${state.scanCooldown}초` : '';
  $('joystick').classList.toggle('hidden', !(me?.role==='hider' && state.phase==='hide'));
  if (state.phase==='result') showResult(); else $('resultBox').classList.add('hidden');
}
function showResult(){
  const alive = state.players.filter(p=>p.role==='hider'&&p.alive).map(p=>p.name);
  $('resultBox').innerHTML = `<h2>라운드 종료</h2><p>끝까지 살아남은 숨는 사람</p><div class="big">${alive.length?escapeHtml(alive.join(', ')):'없음'}</div>`;
  $('resultBox').classList.remove('hidden');
}
function fmt(n){const m=Math.floor(n/60),s=Math.max(0,n%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function setStatus(m){$('status').textContent=m;clearTimeout(setStatus.t);setStatus.t=setTimeout(()=>{$('status').textContent=''},1400)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function resize(){
  if (game.classList.contains('hidden')) return;
  const dpr=Math.min(1.5,window.devicePixelRatio||1); const w=innerWidth,h=innerHeight;
  gameCanvas.width=Math.floor(w*dpr); gameCanvas.height=Math.floor(h*dpr); gameCanvas.style.width=w+'px';gameCanvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0); render();
}
window.addEventListener('resize',resize);

function mapColors(){ return {bg:'#d2c7ab', path:'#e8dec2', a:'#738765',b:'#8a6d62',c:'#b89966',d:'#6e8284',e:'#8e816c',f:'#7c7188',ink:'#4f4b42'}; }
function drawWorld(g, w,h, scale){
  const c=mapColors(); g.clearRect(0,0,w,h); g.fillStyle=c.bg;g.fillRect(0,0,w,h);
  const zones=[[180,180,1800,1200,c.a],[2200,140,2100,1250,c.b],[4650,180,2700,1100,c.c],[170,1650,1950,2050,c.d],[2400,1570,2050,2200,c.e],[4800,1500,2500,2350,c.f],[300,3850,7000,600,'#877e72']];
  for(const z of zones){g.fillStyle=z[4];roundRect(g,z[0],z[1],z[2],z[3],55);}
  g.lineWidth=180;g.lineCap='round';g.strokeStyle=c.path;const roads=[[[100,1320],[1200,1240],[2400,1350],[3800,1320],[5200,1250],[7480,1370]],[[1700,120],[1900,900],[2150,1650],[2050,3000],[1800,4700]],[[4200,100],[4050,800],[4250,1550],[4100,2900],[4200,4700]],[[300,3150],[1600,3020],[2800,3140],[4300,3000],[6000,3120],[7480,3050]]];
  for(const pts of roads){g.beginPath();g.moveTo(...pts[0]);for(let i=1;i<pts.length;i++)g.lineTo(...pts[i]);g.stroke();}
  const objects=[[500,520,130,c.ink],[1200,850,110,'#53644d'],[2700,480,135,'#594d48'],[3500,700,120,'#7b5e4a'],[5550,580,150,'#7d694f'],[6850,680,125,'#6a5e58'],[680,2240,150,'#50686b'],[1500,2420,125,'#4e6252'],[2950,2150,160,'#665d54'],[5450,2220,150,'#5f626f'],[6600,2450,120,'#6e5c73'],[1150,3500,135,'#65594f'],[2600,3900,150,'#5a6651'],[3900,3720,130,'#675c54'],[6100,3780,160,'#5a6668']];
  for(const [x,y,r,col] of objects){g.fillStyle=col;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
  g.strokeStyle='#5d5349';g.lineWidth=22;g.strokeRect(18,18,7600-36,4800-36);
  g.font='bold 44px system-ui';g.fillStyle='#4a4238';g.fillText('명화풍 테스트 맵 · V3',110,4680);
}
function roundRect(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();g.fill()}

function cameraForMe(){
  if(!me)return {x:3800,y:2400};
  return {x:me.x,y:me.y};
}
function worldToScreen(x,y){ return {x:x-camera.x+innerWidth/2,y:y-camera.y+innerHeight/2}; }
function screenToWorld(sx,sy){ return {x:sx-innerWidth/2+camera.x,y:sy-innerHeight/2+camera.y}; }
function render(){
  if (!state) return;
  if (isHost) return renderHostCanvas();
  camera = cameraForMe();
  camera.x=Math.max(innerWidth/2,Math.min(state.map.width-innerWidth/2,camera.x));
  camera.y=Math.max(innerHeight/2,Math.min(state.map.height-innerHeight/2,camera.y));
  ctx.save();
  ctx.translate(innerWidth/2-camera.x,innerHeight/2-camera.y); drawWorld(ctx,state.map.width,state.map.height,1);
  ctx.restore();
  if (state.phase==='hide' || state.phase==='seek') drawPlayers();
  drawEffects();
}
function playerVisible(p){
  if (p.role==='hider' && state.phase==='seek' && p.id!==socket.id){
    if (p.revealUntil && Date.now() < p.revealUntil) return true;
    // Hidden until a scan pulse reveals them. Admin sees everyone separately.
    return false;
  }
  return true;
}
function bodyPath(g, pose){
  g.beginPath();
  if(pose==='lay'){
    g.moveTo(-86,-26);g.quadraticCurveTo(-62,-55,-24,-42);g.quadraticCurveTo(5,-38,38,-34);g.quadraticCurveTo(70,-30,94,-8);g.quadraticCurveTo(76,20,40,26);g.quadraticCurveTo(10,32,-28,28);g.quadraticCurveTo(-72,28,-92,10);g.closePath();
  } else if(pose==='crouch'){
    g.moveTo(-54,72);g.quadraticCurveTo(-78,44,-60,15);g.quadraticCurveTo(-76,-25,-44,-60);g.quadraticCurveTo(-24,-86,8,-96);g.quadraticCurveTo(44,-88,56,-58);g.quadraticCurveTo(70,-24,50,12);g.quadraticCurveTo(78,38,60,70);g.quadraticCurveTo(25,90,0,82);g.quadraticCurveTo(-25,94,-54,72);g.closePath();
  } else {
    g.moveTo(-48,78);g.quadraticCurveTo(-58,40,-48,8);g.quadraticCurveTo(-66,-18,-60,-62);g.quadraticCurveTo(-58,-100,-18,-112);g.quadraticCurveTo(18,-120,42,-94);g.quadraticCurveTo(64,-74,58,-42);g.quadraticCurveTo(56,-10,44,7);g.quadraticCurveTo(58,40,48,78);g.quadraticCurveTo(24,96,0,90);g.quadraticCurveTo(-24,96,-48,78);g.closePath();
  }
}
function drawPlayer(p, targetCtx=ctx, offset={x:0,y:0}, scale=1, showLabel=false){
  if(!playerVisible(p) && targetCtx===ctx) return;
  const sp={x:(p.x-offset.x),y:(p.y-offset.y)}; targetCtx.save();targetCtx.translate(sp.x,sp.y);targetCtx.rotate(p.rotation||0);targetCtx.scale(scale,scale);
  targetCtx.fillStyle='#0003';targetCtx.beginPath();targetCtx.ellipse(0,92,52,13,0,0,Math.PI*2);targetCtx.fill();
  targetCtx.save();bodyPath(targetCtx,p.pose);targetCtx.clip();targetCtx.fillStyle='#f6f1e7';targetCtx.fill();for(const st of p.paint||[]){targetCtx.fillStyle=st.color;targetCtx.beginPath();targetCtx.arc(st.x,st.y,st.radius,0,Math.PI*2);targetCtx.fill();}targetCtx.restore();
  targetCtx.strokeStyle='#151515';targetCtx.lineWidth=1;bodyPath(targetCtx,p.pose);targetCtx.stroke();
  if(showLabel){targetCtx.fillStyle='#141414dd';targetCtx.font='bold 16px system-ui';targetCtx.textAlign='center';targetCtx.fillText(p.name,0,-135)}
  if(p.role==='seeker' && targetCtx===hctx){ targetCtx.strokeStyle='#ef9167';targetCtx.lineWidth=3;targetCtx.beginPath();targetCtx.arc(0,0,18,0,Math.PI*2);targetCtx.stroke(); }
  if(p.revealUntil && Date.now()<p.revealUntil && p.role==='hider'){
    targetCtx.strokeStyle='#fff9';targetCtx.lineWidth=4;targetCtx.beginPath();targetCtx.arc(0,0,112,0,Math.PI*2);targetCtx.stroke();
  }
  targetCtx.restore();
}
function drawPlayers(){
  const ordered=[...renderPlayers.values()].filter(p=>p.alive).sort((a,b)=>a.y-b.y);
  for(const p of ordered) drawPlayer(p,ctx,camera,1,p.id===socket.id);
}
function drawEffects(){
  const now=performance.now(); scanFX=scanFX.filter(f=>now-f.started<1300);
  for(const f of scanFX){
    const a=Math.min(1,(now-f.started)/180); const b=Math.max(0,1-(now-f.started)/1300); const s=worldToScreen(f.x,f.y);
    const grad=ctx.createRadialGradient(s.x,s.y,8,s.x,s.y,95);grad.addColorStop(0,`rgba(255,255,255,${.8*b})`);grad.addColorStop(.3,`rgba(255,90,160,${.35*b})`);grad.addColorStop(.5,`rgba(50,220,255,${.25*b})`);grad.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(s.x,s.y,100*a,0,Math.PI*2);ctx.fill();
  }
  if(state.phase==='seek' && me?.role==='seeker'){ctx.strokeStyle='#ffffffaa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(innerWidth/2,innerHeight/2,8,0,Math.PI*2);ctx.moveTo(innerWidth/2-16,innerHeight/2);ctx.lineTo(innerWidth/2+16,innerHeight/2);ctx.moveTo(innerWidth/2,innerHeight/2-16);ctx.lineTo(innerWidth/2,innerHeight/2+16);ctx.stroke();}
}

gameCanvas.addEventListener('pointerdown',e=>{
  if(!state||!me||state.phase==='waiting'||state.phase==='result')return;
  const r=gameCanvas.getBoundingClientRect();const sx=(e.clientX-r.left),sy=(e.clientY-r.top);const w=screenToWorld(sx,sy);
  if(me.role==='hider'&&state.phase==='hide'){
    const lx=w.x-me.x,ly=w.y-me.y;
    if(eyedropperMode){
      const pixel=ctx.getImageData(sx,sy,1,1).data;$('color').value='#'+[0,1,2].map(i=>pixel[i].toString(16).padStart(2,'0')).join('');eyedropperMode=false;updateToolButtons();setStatus('색을 찍었어요');return;
    }
    if(paintMode && insideBody(lx,ly,me.pose)){painting=true;gameCanvas.setPointerCapture(e.pointerId);paintAt(lx,ly);}
  } else if(me.role==='seeker'&&state.phase==='seek'){
    socket.emit('scan',{x:w.x,y:w.y});
  }
});
gameCanvas.addEventListener('pointermove',e=>{if(!painting||!me)return;const r=gameCanvas.getBoundingClientRect();const sx=e.clientX-r.left,sy=e.clientY-r.top,w=screenToWorld(sx,sy);paintAt(w.x-me.x,w.y-me.y)});
gameCanvas.addEventListener('pointerup',()=>painting=false);gameCanvas.addEventListener('pointercancel',()=>painting=false);
function paintAt(x,y){if(!insideBody(x,y,me.pose))return;socket.emit('paint',{x,y,radius:Number($('brushSize').value)||18,color:$('color').value})}
function insideBody(x,y,pose){ if(pose==='lay') return ((x+5)*(x+5))/(95*95)+(y*y)/(38*38)<1; if(pose==='crouch') return ((x)*(x))/(65*65)+((y+6)*(y+6))/(100*100)<1; return (x*x)/(62*62)+((y+10)*(y+10))/(118*118)<1; }
$('paintToggle').onclick=()=>{paintMode=!paintMode;eyedropperMode=false;updateToolButtons()};$('eyedropperToggle').onclick=()=>{eyedropperMode=!eyedropperMode;paintMode=false;updateToolButtons()};function updateToolButtons(){$('paintToggle').classList.toggle('active',paintMode);$('eyedropperToggle').classList.toggle('active',eyedropperMode)}
document.querySelectorAll('.poseButtons button').forEach(b=>b.onclick=()=>socket.emit('pose',{pose:b.dataset.pose}));

window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){e.preventDefault();if(k==='w'||k==='arrowup')moveVec.y=-1;if(k==='s'||k==='arrowdown')moveVec.y=1;if(k==='a'||k==='arrowleft')moveVec.x=-1;if(k==='d'||k==='arrowright')moveVec.x=1;}});window.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){if(k==='w'||k==='arrowup'||k==='s'||k==='arrowdown')moveVec.y=0;if(k==='a'||k==='arrowleft'||k==='d'||k==='arrowright')moveVec.x=0;}});
const joy=$('joystick'),stick=joy.querySelector('.stick');let joyActive=false;function setJoy(e){const r=joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width/2-25,dx=e.clientX-cx,dy=e.clientY-cy,len=Math.min(max,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);const x=Math.cos(a)*len,y=Math.sin(a)*len;stick.style.transform=`translate(${x}px,${y}px)`;moveVec={x:x/max,y:y/max}}joy.addEventListener('pointerdown',e=>{joyActive=true;joy.setPointerCapture(e.pointerId);setJoy(e)});joy.addEventListener('pointermove',e=>{if(joyActive)setJoy(e)});function resetJoy(){joyActive=false;moveVec={x:0,y:0};stick.style.transform='translate(0,0)'}joy.addEventListener('pointerup',resetJoy);joy.addEventListener('pointercancel',resetJoy);
setInterval(()=>{if(!me||!state||state.phase!=='hide'||me.role!=='hider'||!me.alive)return;const len=Math.hypot(moveVec.x,moveVec.y);if(len<.05)return;const speed=4.6;me.x=Math.max(45,Math.min(state.map.width-45,me.x+moveVec.x*speed*6));me.y=Math.max(45,Math.min(state.map.height-45,me.y+moveVec.y*speed*6));if(len>.1)me.rotation=Math.atan2(moveVec.y,moveVec.x);const now=performance.now();if(now-lastMove>80){socket.emit('move',{x:me.x,y:me.y,rotation:me.rotation});lastMove=now}},40);
setInterval(()=>render(),60);

function renderHost(){
  if(state.settings){for(const id of ['hideSeconds','seekSeconds','baseScanSeconds','finalScanSeconds','finalScanWindowSeconds','scanRadius','revealSeconds']) if(document.activeElement?.id!==id) $(id).value=state.settings[id]}
  $('hostStartBtn').disabled=state.phase!=='waiting'||state.players.length<2;
  renderHostRoster();renderHostCanvas();
}
function renderHostRoster(){
  $('hostStatus').textContent=`현재 ${state.players.length}/${20}명 · 술래 ${state.seekerCount}명 · 숨는 사람 ${state.hiderCount}명 · 상태 ${({waiting:'대기실',hide:'숨기',seek:'찾기',result:'결과'})[state.phase]}`;
  $('hostRoster').innerHTML=state.players.map(p=>`<div class="rosterItem"><span>${escapeHtml(p.name)}</span><span class="role-${p.role}">${p.role==='seeker'?'술래':p.role==='hider'?'숨는 사람':'대기'}</span></div>`).join('');
}
function renderHostCanvas(){
  const w=hostCanvas.clientWidth||1100,h=hostCanvas.clientHeight||700;const dpr=Math.min(1.5,devicePixelRatio||1);hostCanvas.width=Math.floor(w*dpr);hostCanvas.height=Math.floor(h*dpr);hctx.setTransform(dpr,0,0,dpr,0,0);
  const sx=w/state.map.width,sy=h/state.map.height,scale=Math.min(sx,sy),ox=(w-state.map.width*scale)/2,oy=(h-state.map.height*scale)/2;
  hctx.save();hctx.translate(ox,oy);hctx.scale(scale,scale);drawWorld(hctx,state.map.width,state.map.height,scale);for(const p of state.players.filter(p=>p.alive))drawPlayer(p,hctx,{x:0,y:0},1,true);hctx.restore();
}

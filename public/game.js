const socket = io({transports:['websocket','polling']});
const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { alpha:false });
ctx.imageSmoothingEnabled = false;

let state = null;
let me = null;
let paintMode = false;
let eyedropperMode = false;
let catchMode = false;
let painting = false;
let camera = {x:0,y:0};
let lastMove = 0;
let moveVec = {x:0,y:0};
let joystickActive = false;
let renderPlayers = new Map();
const WORLD = { width:5000, height:3200 };

$('joinBtn').onclick = () => socket.emit('join',{roomCode:$('room').value,name:$('name').value});
$('hostBtn').onclick = () => socket.emit('host',{code:$('adminCode').value});
$('startBtn')?.remove();
$('hostStartBtn').onclick = () => socket.emit('start');
$('hostRestartBtn').onclick = () => socket.emit('restart');
$('copyCodeBtn').onclick = async () => { try { await navigator.clipboard.writeText($('hostRoomCode').textContent); toastHost('복사했어요.'); } catch {} };
$('joinError').textContent = '';

socket.on('joinError', m => $('joinError').textContent = m);
socket.on('hostError', m => $('joinError').textContent = m);
socket.on('hostReady', ({roomCode}) => {
  $('lobby').classList.add('hidden'); $('host').classList.remove('hidden');
  $('hostRoomCode').textContent = roomCode;
});
socket.on('joined', ({roomCode}) => {
  $('lobby').classList.add('hidden'); $('waiting').classList.remove('hidden'); $('roomCodeText').textContent = roomCode;
});
socket.on('roomClosed', () => location.reload());

socket.on('state', s => {
  state = s;
  renderPlayers = new Map(s.players.map(p=>[p.id,{...p}]));
  me = s.players.find(p=>p.id===socket.id) || null;
  if ($('host').classList.contains('hidden') === false) {
    $('hostRoomCode').textContent = s.roomCode;
    $('hostRoster').innerHTML = s.players.map(p=>`<div class="playerChip">${escapeHtml(p.name)}</div>`).join('');
    $('hostStartBtn').disabled = s.players.length < 2 || s.phase !== 'waiting';
  }
  $('roster').innerHTML = s.players.map(p=>`<div class="playerChip">${escapeHtml(p.name)}</div>`).join('');
  if (s.phase !== 'waiting' && !$('host').classList.contains('hidden') === false) {}
  if (s.phase !== 'waiting' && $('game').classList.contains('hidden')) {
    $('waiting').classList.add('hidden'); $('game').classList.remove('hidden');
  }
  updateUI();
});

socket.on('caught', ({name}) => setStatus(`${name}을(를) 찾았습니다!`));
socket.on('miss', () => setStatus('조금 더 가까이 가세요.'));

function updateUI(){
  if (!state) return;
  $('round').textContent = state.round;
  $('time').textContent = state.timeLeft + '초';
  $('phaseText').textContent = state.phase==='hide'?'숨기':state.phase==='seek'?'찾기':state.phase==='result'?'결과':'대기';
  const roleText = me?.role === 'seeker' ? '🔎 술래' : me?.role === 'hider' ? (me.alive?'🫥 숨는 사람':'✅ 발견됨') : '';
  $('roleBadge').textContent = roleText;
  if (me?.role === 'hider') { $('paintPanel').classList.remove('hidden'); $('seekPanel').classList.add('hidden'); }
  else if (me?.role === 'seeker') { $('seekPanel').classList.remove('hidden'); $('paintPanel').classList.add('hidden'); }
  if (state.phase==='hide' && me?.role==='hider') { $('roleTitle').textContent='숨는 사람'; $('roleDesc').textContent='먼저 좋은 장소를 찾고, 그다음 몸에 주변 색을 칠하세요.'; $('joystick').style.display='block'; $('paintToggle').classList.remove('hidden'); $('eyedropperToggle').classList.remove('hidden'); $('catchMode').classList.add('hidden'); }
  else if (state.phase==='seek' && me?.role==='seeker') { $('roleTitle').textContent='술래'; $('roleDesc').textContent='카메라는 내가 움직이는 방향으로 함께 이동합니다. 큰 맵을 돌아다니며 찾아보세요.'; $('joystick').style.display='block'; $('paintToggle').classList.add('hidden'); $('eyedropperToggle').classList.add('hidden'); $('catchMode').classList.remove('hidden'); }
  else { $('paintToggle').classList.add('hidden'); $('eyedropperToggle').classList.add('hidden'); }
  if (me) camera = clampCamera(me.x,me.y);
  draw();
}

function clampCamera(x,y){
  const vw = canvas.width, vh = canvas.height;
  return {x:Math.max(vw/2,Math.min(WORLD.width-vw/2,x)), y:Math.max(vh/2,Math.min(WORLD.height-vh/2,y))};
}

function screenToWorld(sx,sy){ return {x:sx+camera.x-canvas.width/2,y:sy+camera.y-canvas.height/2}; }
function worldToScreen(x,y){ return {x:x-camera.x+canvas.width/2,y:y-camera.y+canvas.height/2}; }

function draw(){
  ctx.fillStyle='#d8c9ad'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save(); ctx.translate(canvas.width/2-camera.x, canvas.height/2-camera.y);
  drawWorld();
  ctx.restore();
  if(!state) return;
  const ordered=[...renderPlayers.values()].sort((a,b)=>a.y-b.y);
  for(const p of ordered){
    const localHidden = state.phase==='seek' && p.role==='hider' && p.alive && p.id!==socket.id;
    if (localHidden) continue; // seeker cannot see hiders globally; proximity reveal is handled by target check/highlight below
    drawPerson(p);
  }
  if (me?.role==='seeker' && state.phase==='seek') drawNearbyHints();
}

function drawWorld(){
  // Simple hand-painted, original map: five large zones with paths and landmarks.
  ctx.fillStyle='#cbbd9e'; ctx.fillRect(0,0,WORLD.width,WORLD.height);
  const zones=[
    {x:150,y:150,w:1400,h:900,c:'#8d9f79'}, {x:1750,y:140,w:1450,h:950,c:'#9c7d69'},
    {x:3400,y:180,w:1350,h:1000,c:'#c39e73'}, {x:220,y:1300,w:1550,h:1450,c:'#7d8f95'},
    {x:2050,y:1350,w:1350,h:1400,c:'#91856f'}, {x:3650,y:1370,w:1150,h:1420,c:'#867d98'}
  ];
  for(const z of zones){ ctx.fillStyle=z.c; roundRectFill(z.x,z.y,z.w,z.h,42); }
  // Roads
  ctx.strokeStyle='#d9c9aa'; ctx.lineWidth=130; ctx.lineCap='round';
  const roads=[[[80,1180],[1100,1100],[1950,1280],[3150,1120],[4920,1240]],[[900,150],[1350,750],[1860,1500],[1750,3000]],[[3080,100],[3000,800],[3300,1500],[3050,3000]],[[500,2350],[1500,2250],[2550,2150],[3500,2280],[4800,2420]]];
  for(const pts of roads){ctx.beginPath();ctx.moveTo(...pts[0]);for(let i=1;i<pts.length;i++)ctx.lineTo(...pts[i]);ctx.stroke();}
  // Large decorative objects.
  for(const [x,y,r,c] of [[430,430,90,'#506447'],[1120,690,120,'#5d6d4f'],[2330,460,110,'#6c5d50'],[2850,850,95,'#5d725e'],[4050,590,130,'#7d644e'],[740,1890,140,'#5c6e73'],[1460,2500,120,'#536a58'],[2600,1760,140,'#665c4d'],[3300,2300,130,'#5d6570'],[4420,2140,115,'#6d5e70']]){ ctx.fillStyle=c; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
  // Repeating tiny painted tiles.
  for(let y=350;y<2950;y+=170){ for(let x=300+(y%340);x<4850;x+=260){ if(((x/260)+(y/170))%3===0){ctx.fillStyle='#a28c70';ctx.fillRect(x,y,80,52);ctx.fillStyle='#7c6d5d';ctx.fillRect(x+10,y-12,60,12);} } }
  // Border frame
  ctx.strokeStyle='#604f44'; ctx.lineWidth=20; ctx.strokeRect(0,0,WORLD.width,WORLD.height);
}

function roundRectFill(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fill();}

function bodyPath(){
  ctx.beginPath();
  ctx.moveTo(-38,65); ctx.quadraticCurveTo(-45,35,-34,5); ctx.quadraticCurveTo(-56,-8,-58,-42); ctx.quadraticCurveTo(-62,-72,-42,-94); ctx.quadraticCurveTo(-22,-112,0,-113); ctx.quadraticCurveTo(22,-112,42,-94); ctx.quadraticCurveTo(62,-72,58,-42); ctx.quadraticCurveTo(56,-8,34,5); ctx.quadraticCurveTo(45,35,38,65); ctx.quadraticCurveTo(22,87,0,88); ctx.quadraticCurveTo(-22,87,-38,65); ctx.closePath();
}

function drawPerson(p){
  const s=worldToScreen(p.x,p.y); ctx.save();ctx.translate(s.x,s.y);ctx.rotate(p.rotation||0);
  ctx.fillStyle='#0003';ctx.beginPath();ctx.ellipse(0,72,45,14,0,0,Math.PI*2);ctx.fill();
  // white base + single paintable body
  ctx.save(); bodyPath(); ctx.clip(); ctx.fillStyle='#f7f4ed'; ctx.fill();
  for(const st of (p.paint||[])){ctx.fillStyle=st.color;ctx.beginPath();ctx.arc(st.x,st.y,st.radius,0,Math.PI*2);ctx.fill();}
  ctx.restore();
  ctx.strokeStyle='#554c43';ctx.lineWidth=4;bodyPath();ctx.stroke();
  ctx.fillStyle='#2229';ctx.beginPath();ctx.arc(0,-63,5,0,Math.PI*2);ctx.fill();
  if(p.id===socket.id && p.role==='hider') {ctx.strokeStyle='#2e4d42';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,-10,75,0,Math.PI*2);ctx.stroke();}
  if(p.role==='seeker') {ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,-112,18,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c75b3e';ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.fillText('술래',0,-107);}
  ctx.restore();
}

function drawNearbyHints(){
  if(!me) return;
  for(const p of renderPlayers.values()){
    if(p.id===socket.id || p.role!=='hider' || !p.alive) continue;
    const d=Math.hypot(p.x-me.x,p.y-me.y);
    if(d<180){const s=worldToScreen(p.x,p.y);ctx.save();ctx.strokeStyle='#ffcf59aa';ctx.lineWidth=5;ctx.beginPath();ctx.arc(s.x,s.y,62,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }
}

function worldBodyPointFromEvent(e){
  const r=canvas.getBoundingClientRect();
  const sx=(e.clientX-r.left)*canvas.width/r.width;
  const sy=(e.clientY-r.top)*canvas.height/r.height;
  return {sx,sy,world:screenToWorld(sx,sy)};
}

$('paintToggle').onclick=()=>{paintMode=!paintMode;eyedropperMode=false;updateToolButtons();};
$('eyedropperToggle').onclick=()=>{eyedropperMode=!eyedropperMode;paintMode=false;updateToolButtons();};
$('catchMode').onclick=()=>{catchMode=!catchMode;updateToolButtons();};
function updateToolButtons(){
  $('paintToggle').classList.toggle('active',paintMode); $('eyedropperToggle').classList.toggle('active',eyedropperMode); $('catchMode').classList.toggle('active',catchMode);
}

canvas.addEventListener('pointerdown',e=>{
  if(!me||!state||state.phase==='waiting') return;
  const q=worldBodyPointFromEvent(e);
  if(me.role==='hider' && state.phase==='hide'){
    if(eyedropperMode){
      const sample = sampleWorldColor(q.sx,q.sy);
      $('color').value = sample;
      eyedropperMode=false; updateToolButtons(); setStatus(`색을 골랐어요: ${sample}`); return;
    }
    if(paintMode){
      // Only paint when the pointer lands on the local body.
      const localX=q.world.x-me.x, localY=q.world.y-me.y;
      const inside = pointInBody(localX,localY);
      if(inside){painting=true;canvas.setPointerCapture(e.pointerId);paintAt(localX,localY);}
    }
  }
  if(me.role==='seeker' && state.phase==='seek' && catchMode){
    let best=null,bd=Infinity; for(const p of renderPlayers.values()){ if(p.role!=='hider'||!p.alive)continue; const s=worldToScreen(p.x,p.y); const d=Math.hypot(s.x-q.sx,s.y-q.sy); if(d<bd){bd=d;best=p;} }
    if(best&&bd<70)socket.emit('caught',{targetId:best.id});
  }
});
canvas.addEventListener('pointermove',e=>{
  if(!painting) return; const q=worldBodyPointFromEvent(e); paintAt(q.world.x-me.x,q.world.y-me.y);
});
canvas.addEventListener('pointerup',()=>painting=false);
canvas.addEventListener('pointercancel',()=>painting=false);

function pointInBody(x,y){ return Math.pow(x/60,2)+Math.pow((y+10)/105,2)<1 && y>-110 && y<90; }
function paintAt(x,y){
  if(Math.hypot(x,y)>130) return;
  const color=$('color').value; const radius=Number($('brushSize').value)||16;
  socket.emit('paintStroke',{x,y,radius,color});
}

function sampleWorldColor(sx,sy){
  // Draw just the world at the current camera to a tiny sample buffer.
  const temp=document.createElement('canvas');temp.width=1;temp.height=1;const t=temp.getContext('2d');
  t.imageSmoothingEnabled=false;
  const wx=camera.x-canvas.width/2+sx, wy=camera.y-canvas.height/2+sy;
  // Fast deterministic palette sample from the current world zones/roads.
  let color='#cbbd9e';
  const zones=[ [150,150,1400,1050,'#8d9f79'],[1750,140,1450,1090,'#9c7d69'],[3400,180,1350,1000,'#c39e73'],[220,1300,1550,1450,'#7d8f95'],[2050,1350,1350,1400,'#91856f'],[3650,1370,1150,1420,'#867d98'] ];
  for(const z of zones) if(wx>z[0]&&wx<z[0]+z[2]&&wy>z[1]&&wy<z[1]+z[3]) color=z[4];
  // Sample a patch by drawing the world on the tiny canvas for better road accuracy.
  const scale=1; t.save(); t.translate(0,0); t.fillStyle=color;t.fillRect(0,0,1,1); t.restore();
  return rgbToHex(t.getImageData(0,0,1,1).data);
}
function rgbToHex(d){return '#'+[0,1,2].map(i=>d[i].toString(16).padStart(2,'0')).join('');}

function setStatus(msg){$('status').textContent=msg;clearTimeout(setStatus.t);setStatus.t=setTimeout(()=>$('status').textContent='',1300)}
function toastHost(msg){$('hostError').textContent=msg;setTimeout(()=>$('hostError').textContent='',1300)}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

// Keyboard fallback + on-screen joystick.
window.addEventListener('keydown',e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){ e.preventDefault(); if(k==='w'||k==='arrowup')moveVec.y=-1;if(k==='s'||k==='arrowdown')moveVec.y=1;if(k==='a'||k==='arrowleft')moveVec.x=-1;if(k==='d'||k==='arrowright')moveVec.x=1;} });
window.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){ if(k==='w'||k==='arrowup'||k==='s'||k==='arrowdown')moveVec.y=0;if(k==='a'||k==='arrowleft'||k==='d'||k==='arrowright')moveVec.x=0;}});

const joy=$('joystick'),stick=joy.querySelector('.stick');
function setJoystick(e){const r=joy.getBoundingClientRect();const dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),max=r.width/2-25,len=Math.min(max,Math.hypot(dx,dy));const ang=Math.atan2(dy,dx);const x=Math.cos(ang)*len,y=Math.sin(ang)*len;stick.style.transform=`translate(${x}px,${y}px)`;moveVec={x:x/max,y:y/max};}
joy.addEventListener('pointerdown',e=>{joystickActive=true;joy.setPointerCapture(e.pointerId);setJoystick(e)});
joystickActive=false;joy.addEventListener('pointermove',e=>{if(joystickActive)setJoystick(e)});joy.addEventListener('pointerup',()=>{joystickActive=false;moveVec={x:0,y:0};stick.style.transform='translate(0,0)'});joy.addEventListener('pointercancel',()=>{joystickActive=false;moveVec={x:0,y:0};stick.style.transform='translate(0,0)'});

setInterval(()=>{
  if(!me||!state||!['hide','seek'].includes(state.phase)||!me.alive)return;
  if(state.phase==='hide' && me.role!=='hider') return;
  const len=Math.hypot(moveVec.x,moveVec.y); if(len<0.05)return;
  const speed=state.phase==='seek'?5.5:4.5;
  me.x=Math.max(35,Math.min(WORLD.width-35,me.x+moveVec.x*speed*6));
  me.y=Math.max(35,Math.min(WORLD.height-35,me.y+moveVec.y*speed*6));
  me.rotation=Math.atan2(moveVec.y,moveVec.x);
  camera=clampCamera(me.x,me.y);
  const now=performance.now(); if(now-lastMove>90){socket.emit('move',{x:me.x,y:me.y,rotation:me.rotation});lastMove=now;}
  draw();
},40);

setInterval(()=>draw(),100);

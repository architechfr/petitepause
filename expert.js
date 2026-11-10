'use strict';
/* Sans Croiser — nouvelle génération de puzzles. Plateaux statiques, solutions vérifiées. */
const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d', {alpha: false});
const PALETTE = ['#eb5266','#347cef','#16ad79','#ed9f37','#9a65e8','#14a4b5','#d45f9c','#819c31','#b86c4d'];
const PROGRESS = 'sans-croiser-expert-progress-2026-v2'; // v2 (11/11/2026) : nouvelles grilles a solution unique, progression repartie de zero
const SESSION = 'sans-croiser-expert-session-2026-v2';
const preview = new URLSearchParams(location.search).get('final')==='1';
const LEVELS = window.SC_LEVELS;
if(!Array.isArray(LEVELS)||LEVELS.length!==60)throw Error('Données des niveaux manquantes');
function ek(a,b){return a<b?a+':'+b:b+':'+a}
function isAdjacent(a,b,n){return Math.abs(a%n-b%n)+Math.abs(Math.floor(a/n)-Math.floor(b/n))===1}
function validate(level){
 const {n,pairs,walls,solution}=level,blocked=new Set(walls.map(([a,b])=>ek(a,b)));
 if(n<6||pairs.length>PALETTE.length||pairs.length!==solution.length)return false;
 const cells=new Set();
 for(let i=0;i<pairs.length;i++){
  const path=solution[i];if(path.length<3||path[0]!==pairs[i][0]||path.at(-1)!==pairs[i][1])return false;
  for(let j=0;j<path.length;j++){
   const cell=path[j];if(!Number.isInteger(cell)||cell<0||cell>=n*n||cells.has(cell))return false;
   cells.add(cell);
   if(j>0&&(!isAdjacent(path[j-1],cell,n)||blocked.has(ek(path[j-1],cell))))return false;
  }
 }
 return cells.size===n*n;
}
for(let i=0;i<LEVELS.length;i++)if(!validate(LEVELS[i]))throw Error('Niveau non résoluble : '+(i+1));
for(const l of LEVELS)l.wallSet=new Set(l.walls.map(([a,b])=>ek(a,b)));
let progress={unlocked:1,current:0,best:{}};
try{const stored=JSON.parse(localStorage.getItem(PROGRESS)||'null');if(stored&&Number.isInteger(stored.unlocked))progress={...progress,...stored}}catch(_){ }
progress.unlocked=Math.max(1,Math.min(60,progress.unlocked));
progress.current=Math.max(0,Math.min(progress.unlocked-1,progress.current|0));
let current=preview?59:progress.current,level=LEVELS[current],paths=[],active=null,undoStack=[],won=false;
let hints=0,errors=0,startedAt=null,seconds=0,sounds=true,audio=null,viewSize=500;
let hintColor=-1,hintUntil=0,pendingToast=null,previewChange=false;
function emptyPaths(){return level.pairs.map(()=>[])}
function saveProgress(){if(preview)return;try{localStorage.setItem(PROGRESS,JSON.stringify(progress))}catch(_){}}
function saveSession(){if(preview)return;try{localStorage.setItem(SESSION,JSON.stringify({index:current,paths,seconds:elapsed(),hints,errors}))}catch(_){}}
function popToast(text,bad=false){
 const e=$('toast');e.textContent=text;e.classList.toggle('error',bad);e.classList.add('visible');
 clearTimeout(pendingToast);pendingToast=setTimeout(()=>e.classList.remove('visible'),2100);
}
function playSound(ok=true){if(!sounds)return;try{
 audio=audio||new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();
 const now=audio.currentTime,osc=audio.createOscillator(),gain=audio.createGain();
 osc.type='sine';osc.frequency.setValueAtTime(ok?520:190,now);osc.frequency.exponentialRampToValueAtTime(ok?830:120,now+.11);
 gain.gain.setValueAtTime(.025,now);gain.gain.exponentialRampToValueAtTime(.001,now+.16);
 osc.connect(gain);gain.connect(audio.destination);osc.start(now);osc.stop(now+.17);
 }catch(_){}}
function vibrate(t=12){try{navigator.vibrate?.(t)}catch(_){}}
function endpoints(i){return level.pairs[i]}
function connected(i){const p=paths[i],v=endpoints(i);return p.length>1&&((p[0]===v[0]&&p.at(-1)===v[1])||(p[0]===v[1]&&p.at(-1)===v[0]))}
function connectedCount(){return paths.reduce((n,p,i)=>n+Number(connected(i)),0)}
function occupiedCount(){return paths.reduce((n,p)=>n+p.length,0)}
function elapsed(){return seconds+(startedAt===null?0:(performance.now()-startedAt)/1000)}
function clockLabel(sec){sec=Math.floor(sec);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
function renderStats(){
 const done=connectedCount(),remain=level.n*level.n-occupiedCount();
 $('levelNum').textContent=String(current+1).padStart(2,'0');$('connectedNum').textContent=done;$('totalPairs').textContent=' / '+level.pairs.length;
 $('tagLevel').textContent=(preview?'DÉFI FINAL · ':'NIVEAU '+String(current+1).padStart(2,'0')+' · ')+(level.n+' × '+level.n+' · '+level.pairs.length+' COULEURS');
 $('levelTitle').textContent=preview?'Le test ultime':current<9?'Réfléchis avant de tracer':current<30?'L’étau se resserre':'Maître des lignes';
 $('remainText').textContent=remain+' case'+(remain>1?'s':'')+' libre'+(remain>1?'s':'');
 $('statusText').textContent=won?'Grille entièrement remplie !':done===level.pairs.length?'Toutes les paires sont reliées, mais il reste des cases vides !':active?'Attention aux murs gris et aux autres couleurs':'Relie les couleurs et remplis CHAQUE case';
 $('progressFill').style.width=(occupiedCount()/(level.n*level.n)*100).toFixed(2)+'%';
 $('boardGlow').classList.toggle('complete',won);$('undoBtn').disabled=undoStack.length===0;$('hintBtn').disabled=won;
 $('clock').textContent=clockLabel(elapsed());
}
function loadLevel(i,resume=false){
 if(i<0||i>=60||(!preview&&i>=progress.unlocked))return;
 current=i;level=LEVELS[i];paths=emptyPaths();active=null;won=false;undoStack=[];
 hints=errors=seconds=0;startedAt=null;hintColor=-1;hintUntil=0;
 if(!preview){progress.current=i;saveProgress()}
 if(resume&&!preview){
  try{
   const v=JSON.parse(localStorage.getItem(SESSION)||'null');if(v?.index===i&&Array.isArray(v.paths)&&v.paths.length===level.pairs.length){
    const paths2=v.paths.map(x=>Array.isArray(x)?x:[]),used=new Set();let valid=true;
    for(let c=0;c<paths2.length;c++){
     const p=paths2[c],end=endpoints(c);if(p.length&&p[0]!==end[0]&&p[0]!==end[1])valid=false;
     for(let t=0;t<p.length;t++){
      if(!Number.isInteger(p[t])||p[t]<0||p[t]>=level.n*level.n||used.has(p[t]))valid=false;
      used.add(p[t]);
      if(t&&(!isAdjacent(p[t-1],p[t],level.n)||level.wallSet.has(ek(p[t-1],p[t]))))valid=false;
     }
    }
    if(valid){paths=paths2;seconds=Math.max(0,Number(v.seconds)||0);errors=Math.max(0,Number(v.errors)||0);hints=Math.max(0,Number(v.hints)||0)}
   }
  }catch(_){}
 }
 $('clock').textContent=clockLabel(0);closeModal('levelsOverlay');closeModal('winOverlay');
 renderStats();draw();saveSession();
}
function undo(){if(won||!undoStack.length)return;paths=undoStack.pop();active=null;renderStats();draw();saveSession()}
function reset(){paths=emptyPaths();active=null;undoStack=[];won=false;seconds=0;startedAt=null;hints=0;errors=0;hintColor=-1;
 closeModal('winOverlay');renderStats();draw();saveSession()}
function finish(){
 if(won)return;won=true;seconds=elapsed();startedAt=null;
 const stars=(errors+hints===0)?3:(errors+hints<=2?2:1);
 if(!preview){progress.unlocked=Math.min(60,Math.max(progress.unlocked,current+2));progress.best[current]=Math.max(progress.best[current]||0,stars);saveProgress()}
 saveSession();renderStats();playSound(true);vibrate(35);
 $('winTime').textContent=clockLabel(seconds);$('winHints').textContent=hints;$('winErrors').textContent=errors;
 $('winStars').innerHTML='★'.repeat(stars)+'<span class="off">'+'★'.repeat(3-stars)+'</span>';
 $('winTitle').textContent='Bravo, tu as réussi !';
 $('winSubtitle').textContent='Les '+level.n*level.n+' cases sont remplies sans aucun croisement.';
 $('nextBtn').textContent=current===59?'Les 60 niveaux terminés !':'Niveau suivant →';$('nextBtn').disabled=current===59;
 setTimeout(()=>{if(won)openModal('winOverlay')},450);
}
function checkWin(){if(connectedCount()===level.pairs.length){
 if(occupiedCount()===level.n*level.n)finish();
 else popToast('Encore '+(level.n*level.n-occupiedCount())+' cases à remplir !',true);
}}
function cellFromEvent(e){const b=canvas.getBoundingClientRect(),s=b.width,m=s*.038,cell=(s-2*m)/level.n;
 const x=Math.floor((e.clientX-b.left-m)/cell),y=Math.floor((e.clientY-b.top-m)/cell);
 return x<0||y<0||x>=level.n||y>=level.n?-1:y*level.n+x;
}
function whoOwns(cell){for(let i=0;i<paths.length;i++)if(paths[i].includes(cell))return i;return -1}
function startDrag(e){
 if(won||document.querySelector('.overlay.visible')||(e.pointerType==='mouse'&&e.button!==0))return;
 const cell=cellFromEvent(e),i=level.pairs.findIndex(p=>p.includes(cell));
 if(i<0)return;
 undoStack.push(paths.map(p=>p.slice()));if(undoStack.length>70)undoStack.shift();
 paths[i]=[cell];const pair=endpoints(i);
 active={pointer:e.pointerId,i,trace:paths[i],goal:pair[0]===cell?pair[1]:pair[0]};
 if(startedAt===null)startedAt=performance.now();
 try{canvas.setPointerCapture(e.pointerId)}catch(_){}
 renderStats();draw();e.preventDefault();
}
function stepTo(cell){
 if(!active||cell<0)return false;
 const p=active.trace,n=level.n,last=p.at(-1),i=active.i;
 if(cell===last)return true;
 if(!isAdjacent(last,cell,n)||level.wallSet.has(ek(last,cell)))return false;
 const prev=p.indexOf(cell);
 if(prev>=0){p.splice(prev+1);renderStats();draw();return true}
 const who=whoOwns(cell);if(who>=0&&who!==i)return false;
 if(level.pairs.some((ends,j)=>j!==i&&ends.includes(cell)))return false;
 if(endpoints(i).includes(cell)&&cell!==active.goal)return false;
 if(p.includes(active.goal))return false;
 p.push(cell);
 if(cell===active.goal){active=null;playSound(true);vibrate(10);saveSession();checkWin()}
 renderStats();draw();return true;
}
function moveDrag(e){
 if(!active||active.pointer!==e.pointerId)return;
 const cell=cellFromEvent(e);if(cell<0)return;
 const trace=active.trace,last=trace.at(-1);if(last===cell)return;
 // Never allow diagonal shortcuts. When one event skips cells, traverse straight through each intermediate cell.
 const n=level.n,ax=last%n,ay=Math.floor(last/n),bx=cell%n,by=Math.floor(cell/n);
 if(ax!==bx&&ay!==by){
  if(Math.abs(ax-bx)+Math.abs(ay-by)>2)return;
  // For diagonal motion choose a single vertical/horizontal neighbour only when cursor is in an adjacent cell.
  return;
 }
 let cursor=last,steps=0;
 while(cursor!==cell&&active&&steps++<n){
  const next=ax===bx?cursor+(by>ay?n:-n):cursor+(bx>ax?1:-1);
  if(!stepTo(next))break;
  cursor=next;
 }
 e.preventDefault();
}
function endDrag(e){if(active&&e.pointerId===active.pointer){active=null;saveSession();renderStats();draw()}
 if(e.preventDefault)e.preventDefault()}
function resize(){const width=canvas.getBoundingClientRect().width;if(!width)return;viewSize=width;
 const dpr=Math.min(window.devicePixelRatio||1,2.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(width*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
function draw(){
 if(!level)return;
 const s=viewSize,n=level.n,m=s*.038,cs=(s-2*m)/n;
 const xy=(id)=>[m+((id%n)+.5)*cs,m+(Math.floor(id/n)+.5)*cs];
 ctx.fillStyle='#f9fbff';ctx.fillRect(0,0,s,s);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  ctx.fillStyle=((x+y)&1)?'#f1f5fa':'#fcfdff';ctx.fillRect(m+x*cs,m+y*cs,cs,cs);
 }
 ctx.strokeStyle='#d8e3ee';ctx.lineWidth=Math.max(1,s*.0016);ctx.beginPath();
 for(let j=0;j<=n;j++){ctx.moveTo(m+j*cs,m);ctx.lineTo(m+j*cs,s-m);ctx.moveTo(m,m+j*cs);ctx.lineTo(s-m,m+j*cs)}ctx.stroke();
 for(let i=0;i<paths.length;i++){
  const points=paths[i];if(!points.length)continue;
  ctx.strokeStyle=PALETTE[i];ctx.lineWidth=cs*.39;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=connected(i)?1:.72;
  ctx.beginPath();let p=xy(points[0]);ctx.moveTo(p[0],p[1]);
  for(let j=1;j<points.length;j++){p=xy(points[j]);ctx.lineTo(p[0],p[1])}ctx.stroke();ctx.globalAlpha=1;
 }
 if(hintColor>=0&&performance.now()<hintUntil&&!connected(hintColor)){
  const arr=level.solution[hintColor];ctx.save();ctx.setLineDash([cs*.18,cs*.12]);ctx.strokeStyle=PALETTE[hintColor];ctx.globalAlpha=.6;
  ctx.lineWidth=Math.max(3,cs*.13);ctx.lineCap='round';ctx.beginPath();let v=xy(arr[0]);ctx.moveTo(v[0],v[1]);
  for(let j=1;j<arr.length;j++){v=xy(arr[j]);ctx.lineTo(v[0],v[1])}ctx.stroke();ctx.restore();
 }
 for(const [a,b] of level.walls){
  const aa=xy(a),bb=xy(b),mx=(aa[0]+bb[0])/2,my=(aa[1]+bb[1])/2;
  ctx.strokeStyle='#566d85';ctx.lineCap='round';ctx.lineWidth=Math.max(3,cs*.13);ctx.beginPath();
  if(Math.abs(a-b)===1){ctx.moveTo(mx,my-cs*.36);ctx.lineTo(mx,my+cs*.36)}
  else{ctx.moveTo(mx-cs*.36,my);ctx.lineTo(mx+cs*.36,my)}ctx.stroke();
 }
 level.pairs.forEach((ends,i)=>ends.forEach(id=>{
  const [x,y]=xy(id),r=cs*.335;
  ctx.save();ctx.shadowColor='#16294366';ctx.shadowBlur=cs*.14;ctx.shadowOffsetY=2;
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=PALETTE[i];ctx.fill();ctx.restore();
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(2,cs*.065);ctx.stroke();
  ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 '+Math.max(11,Math.round(cs*.4))+'px system-ui,sans-serif';ctx.fillText(i+1,x,y+cs*.018);
 }));
}
function hint(){if(won)return;const open=level.solution.map((path,i)=>({path,i})).filter(x=>!connected(x.i));
 if(!open.length){popToast('Les couleurs sont reliées : remplis les cases manquantes !');return}
 open.sort((a,b)=>b.path.length-a.path.length);hintColor=open[0].i;hintUntil=performance.now()+6000;
 hints++;popToast('Le pointillé montre une route possible pour le '+(hintColor+1));draw();saveSession();
 setTimeout(()=>{if(performance.now()>=hintUntil){hintColor=-1;draw()}},6100);
}
function openModal(id){$(id).classList.add('visible');if(id==='levelsOverlay')levelPicker()}
function closeModal(id){$(id).classList.remove('visible')}
function levelPicker(){const root=$('levelGrid');root.textContent='';$('unlockedLabel').textContent=preview?'Défi final en accès libre':progress.unlocked+' niveaux débloqués';
 for(let i=0;i<60;i++){const locked=!preview&&i>=progress.unlocked,b=document.createElement('button');
  b.className='levelbtn'+(i===current?' current':'')+(locked?' locked':'');b.disabled=locked;
  b.setAttribute('aria-label','Niveau '+(i+1)+(locked?' verrouillé':''));b.textContent=locked?'🔒':(i+1);
  const star=progress.best[i]||0;if(star&&!locked){const e=document.createElement('span');e.className='medal';e.textContent='★'.repeat(star);b.appendChild(e)}
  b.addEventListener('click',()=>loadLevel(i));root.appendChild(b)}
}
function shareAddress(){if(location.protocol!=='http:'&&location.protocol!=='https:')return '';
 const url=new URL(location.href);url.search='';url.hash='';return url.toString()}
function drawQr(address){
 const qr=new QRCore.QRCode(0,QRCore.Level.M);qr.addData(address);qr.make();
 const count=qr.getModuleCount(),quiet=4,scale=7,size=(count+quiet*2)*scale,c=$('shareQrCanvas');c.width=c.height=size;
 const c2=c.getContext('2d',{alpha:false});c2.fillStyle='#fff';c2.fillRect(0,0,size,size);
 c2.fillStyle='#11213b';for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(qr.isDark(y,x))c2.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);
}
function showShare(){const address=shareAddress();$('shareUrl').value=address||'Adresse disponible une fois en ligne';
 $('shareQrWrap').hidden=!address;$('shareOfflineNotice').hidden=!!address;
 $('copyShareBtn').disabled=$('nativeShareBtn').disabled=!address;
 if(address){try{drawQr(address)}catch(_){$('shareQrWrap').hidden=true;popToast('QR code indisponible',true)}}openModal('shareOverlay');
}
async function copyShare(){const link=shareAddress();if(!link)return;
 try{await navigator.clipboard.writeText(link);popToast('Lien copié !')}
 catch(_){const el=$('shareUrl');el.focus();el.select();popToast('Sélectionne puis copie le lien')}
}
async function nativeShare(){const link=shareAddress();if(!link)return;
 if(navigator.share){try{await navigator.share({title:'Sans Croiser — Édition Expert',text:'Rempliras-tu toute la grille ?',url:link})}catch(e){if(e.name!=='AbortError')copyShare()}}
 else copyShare();
}
function formatIntro(){
 document.querySelector('.brand small').textContent='ÉDITION CASSE-TÊTE';
 document.querySelector('.intro p').innerHTML='Relie chaque paire <b>sans croiser</b> et <b style="color:#7ce7ca">remplis 100 % de la grille.</b>';
 document.querySelector('#helpOverlay .dialog > p').textContent='Cette version est volontairement exigeante : relier les numéros ne suffit plus.';
 document.querySelectorAll('#helpOverlay .howrow span:last-child').forEach((el,i)=>{
  el.innerHTML=[
   'Glisse d’une case à la suivante pour relier les <b>mêmes numéros</b>. Tu peux recommencer une couleur à tout moment.',
   'Interdiction de croiser, partager une case ou franchir les <b>barres grises</b>. Aucun raccourci diagonal.',
   'Toutes les paires doivent être reliées <b>ET toutes les cases remplies</b>. Si tu laisses une case vide, le niveau n’est pas gagné.'
  ][i];
 });
 document.querySelector('#helpOverlay .tipbox').innerHTML='<b>Astuce :</b> surveille les cases isolées, les couloirs et les coins avant de relier les couleurs proches.';
 document.querySelector('.foot').textContent='60 défis vérifiés · Mode expert · Sans publicité';
 const btn=document.createElement('button');btn.className='final-launch';btn.type='button';btn.id='finalBtn';
 btn.textContent=preview?'↩ Revenir au parcours':'⚡ Tester directement le niveau 60';
 btn.addEventListener('click',()=>{const url=new URL(location.href);url.search=preview?'':'?final=1';location.href=url.toString()});
 $('shareBtn').before(btn);
 const css=document.createElement('style');css.textContent='.final-launch{width:100%;margin:12px auto 0;display:block;padding:12px 15px;border-radius:14px;background:#302551;color:#ddd2ff;border:1px solid #775eab;font:800 13px system-ui;cursor:pointer}.final-launch:hover{background:#413260}.board canvas{touch-action:none;cursor:crosshair}.boardstatus strong{color:#7fe5c4}';document.head.appendChild(css);
}
formatIntro();
canvas.addEventListener('pointerdown',startDrag,{passive:false});canvas.addEventListener('pointermove',moveDrag,{passive:false});
canvas.addEventListener('pointerup',endDrag,{passive:false});canvas.addEventListener('pointercancel',endDrag,{passive:false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
$('undoBtn').addEventListener('click',undo);$('resetBtn').addEventListener('click',reset);$('hintBtn').addEventListener('click',hint);
$('levelsBtn').addEventListener('click',()=>openModal('levelsOverlay'));$('helpBtn').addEventListener('click',()=>openModal('helpOverlay'));
$('shareBtn').addEventListener('click',showShare);$('copyShareBtn').addEventListener('click',copyShare);$('nativeShareBtn').addEventListener('click',nativeShare);
$('winReplayBtn').addEventListener('click',reset);$('nextBtn').addEventListener('click',()=>{if(current<59)loadLevel(current+1)});
$('soundBtn').addEventListener('click',()=>{sounds=!sounds;$('soundWave').style.display=sounds?'':'none';popToast(sounds?'Son activé':'Son désactivé')});
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>closeModal(el.dataset.close)));
document.querySelectorAll('.overlay').forEach(el=>{if(el.id!=='winOverlay')el.addEventListener('click',e=>{if(e.target===el)closeModal(el.id)})});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){['levelsOverlay','helpOverlay','shareOverlay'].forEach(closeModal)}
 if((e.ctrlKey||e.metaKey)&&(e.key==='z'||e.key==='Z')){e.preventDefault();undo()}
 if((e.key==='r'||e.key==='R')&&!document.querySelector('.overlay.visible'))reset()});
window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
loadLevel(current,true);resize();
setInterval(()=>{if(startedAt!==null&&!won)$('clock').textContent=clockLabel(elapsed())},250);
// Diagnostic without game spoilers for external UI smoke tests.
window.SC_STATUS=()=>({level:current+1,size:level.n,connected:connectedCount(),occupied:occupiedCount(),total:level.n*level.n,won});
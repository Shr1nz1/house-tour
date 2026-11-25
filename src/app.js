import * as THREE from 'three';
import {ROUTES, canPassDoor, routeAvailable, crossing} from './routes.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const $=s=>document.querySelector(s), canvas=$('#view');
const doorInfo={
 Door_Master:{label:'主卧门',type:'85° 平开',pos:[4.18,1.52,7.13],target:[3.20,1.11,7.09]},
 Door_Second:{label:'次卧门',type:'85° 平开',pos:[4.18,1.52,6.28],target:[4.24,1.10,5.03]},
 Door_Bath:{label:'卫生间门',type:'沿墙推拉',pos:[4.17,1.48,8.86],target:[3.44,1.07,8.84]}
};
const rooms={
 dining:{name:'餐厅',pos:[4.64,1.48,7.18],target:[5.65,1.18,6.37]},
 master:{name:'主卧',pos:[2.80,1.48,6.50],target:[1.25,1.0,5.42]},
 second:{name:'次卧',pos:[4.48,1.48,2.13],target:[5.65,1.0,3.80]},
 kitchen:{name:'厨房',pos:[5.20,1.48,8.78],target:[5.55,1.22,9.90]},
 bath:{name:'卫生间',pos:[2.91,1.38,8.92],target:[2.62,1.20,9.72]},
 balcony:{name:'阳台',pos:[5.03,1.43,.76],target:[6.45,1.13,.72]},
 entry:{name:'玄关',pos:[3.87,1.48,9.05],target:[3.86,1.20,7.38]}
};
let renderer,scene,camera,controls,model,mixer,ready=false,overview=false,yaw=0,pitch=0,drag=null,moving=null,focusDoor='Door_Master';
const doors={},raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let previousTime=performance.now();
let ceilingParts=[],hits=[],composer,contactAO,fxaa,quality='detail';
// Transparent glazing and sheer fabric must not become opaque AO occluders.
class InteriorContactPass extends GTAOPass{
 _overrideVisibility(){
  super._overrideVisibility();
  this.scene.traverse(o=>{
   if(!o.isMesh||!o.visible)return;
   const materials=Array.isArray(o.material)?o.material:[o.material];
   if(materials.every(m=>m?.transparent&&m.opacity<.7)){
    o.visible=false;this._visibilityCache.push(o);
   }
  });
 }
}
function sizeView(){
 if(!renderer)return;const r=canvas.getBoundingClientRect();
 const dpr=Math.min(devicePixelRatio,quality==='detail'?1.5:1.1);
 renderer.setPixelRatio(dpr);renderer.setSize(r.width,r.height,false);
 camera.aspect=r.width/r.height;camera.updateProjectionMatrix();
 composer.setPixelRatio(dpr);composer.setSize(r.width,r.height);
 contactAO.setSize(Math.max(1,Math.round(r.width*dpr*.7)),Math.max(1,Math.round(r.height*dpr*.7)));
 fxaa.material.uniforms.resolution.value.set(1/(r.width*dpr),1/(r.height*dpr));
 navDirty=true;viewDirty=true;
}
function chooseQuality(value){
 quality=value;contactAO.enabled=value==='detail';
 for(const b of document.querySelectorAll('[data-quality]'))b.setAttribute('aria-pressed',String(b.dataset.quality===value));
 $('#qualityNote').textContent=value==='detail'?'细腻阴影与材质层次':'优先保持操作流畅';
 try{localStorage.setItem('house-quality-v6',value);}catch{}
 sizeView();if(renderer)renderer.shadowMap.needsUpdate=true;
}
let viewDirty=true;
let currentRoom='dining',journey=null,navDirty=true,lastNavAt=0;
const portals=new Map(),portalLayer=document.createElement('div');portalLayer.id='doorPortals';canvas.parentElement.append(portalLayer);
const backToDoor=document.createElement('button');backToDoor.id='backToDoor';backToDoor.type='button';backToDoor.hidden=true;canvas.parentElement.append(backToDoor);
for(const [id,route] of Object.entries(ROUTES)){
 const enter=document.createElement('button');enter.type='button';enter.className='passAction';enter.dataset.enter=id;enter.dataset.needsModel='';enter.disabled=true;enter.textContent='开门后进入'+route.name;enter.setAttribute('aria-label','进入'+route.name);enter.onclick=()=>traverseDoor(id);$(`[data-card="${id}"]`).append(enter);
 const portal=document.createElement('button');portal.type='button';portal.className='doorPortal';portal.hidden=true;portal.dataset.portal=id;portal.onclick=e=>{e.stopPropagation();traverseDoor(id);};portalLayer.append(portal);portals.set(id,portal);
}
$('.intro').textContent='点击门扇打开，开门后点「进入」走到下一空间。关门可用下方按钮。';
backToDoor.onclick=()=>{const entry=Object.entries(ROUTES).find(([,r])=>r.room===currentRoom);if(!entry)return;const [id,r]=entry;if(focusDoor===id)goIndoor(r.insidePosition,r.insideTarget,rooms[r.room].name,null,r.room);else goDoor(id);};

function message(text){$('#status').textContent=text;}
function updateButtons(){
 document.querySelectorAll('[data-needs-model]').forEach(b=>b.disabled=!ready||Boolean(journey));
 for(const [id,d] of Object.entries(doors)){
  const open=d.target>0;
  const btn=$(`[data-toggle="${id}"]`);btn.textContent=open?'关门':'开门';btn.setAttribute('aria-label',(open?'关闭':'打开')+doorInfo[id].label);btn.setAttribute('aria-pressed',String(open));
  $(`[data-state="${id}"]`).textContent=d.moving?(open?'正在打开':'正在关闭'):(open?'已打开':'已关闭');
  $(`[data-card="${id}"]`).classList.toggle('open',open);
  const destination=crossing(id,currentRoom);const enter=$(`[data-enter="${id}"]`);enter.disabled=!destination||!canPassDoor(d,Boolean(journey));enter.textContent=!destination?'先返回公共区域':(canPassDoor(d)?destination.label:'开门后'+destination.label);enter.setAttribute('aria-label',destination?destination.label:'进入'+ROUTES[id].name);
 }
}
function setDoor(id,open,focus=false){
 if(!ready||journey)return;
 if(focus&&!overview)goDoor(id);
 const d=doors[id];d.start=d.t;d.target=open?d.duration:0;d.elapsed=0;d.moving=true;updateButtons();
 message(doorInfo[id].label+(open?'正在打开…':'正在关闭…'));document.body.classList.remove('menu-open');navDirty=true;viewDirty=true;
}
function toggleDoor(id){if(doors[id])setDoor(id,doors[id].target===0,true);}
function lookAtPoint(target){
 camera.lookAt(new THREE.Vector3(...target));const d=new THREE.Vector3();camera.getWorldDirection(d);yaw=Math.atan2(d.x,d.z);pitch=Math.asin(d.y);
}
function setCeiling(show){let changed=false;for(const o of ceilingParts){if(o.visible!==show)changed=true;o.visible=show;}if(changed){renderer.shadowMap.needsUpdate=true;viewDirty=true;}}
function goIndoor(pos,target,title,doorId=null,space=null){
 document.body.classList.remove('menu-open');
 overview=false;moving=null;journey=null;controls.enabled=false;navDirty=true;viewDirty=true;
 if(space)currentRoom=space;else{const selected=Object.entries(rooms).find(([,r])=>r.name===title);if(selected)currentRoom=selected[0];}setCeiling(true);camera.fov=72;camera.updateProjectionMatrix();camera.position.set(...pos);lookAtPoint(target);
 $('#viewTitle').textContent=title;$('#modeTag').textContent='室内漫游';$('#hint').textContent=doorId?'点门打开 · 开门后点「进入」穿过门口':(Object.values(ROUTES).some(r=>r.room===currentRoom)?'拖动画面看四周 · 点「看门口」可返回':'拖动画面环视 · 可切换房间或查看房门');focusDoor=doorId;
 document.querySelectorAll('[data-room]').forEach(b=>b.classList.toggle('active',rooms[b.dataset.room].name===title));
 document.querySelectorAll('[data-focus]').forEach(b=>b.classList.toggle('active',b.dataset.focus===doorId));
 $('#overview').classList.remove('active');
 updateButtons();syncBackButton();
}
function goDoor(id){const r=ROUTES[id],inside=currentRoom===r.room;const pos=inside?r.insidePosition:r.outsidePosition;goIndoor(pos,r.center,r.name+'门口',id,inside?r.room:r.outside);message(canPassDoor(doors[id])?'房门已开，点击「'+crossing(id,currentRoom).label+'」继续':'点击房门打开，再点「进入」前往下一空间');}
function goOverview(){
 if(!ready||journey)return;document.body.classList.remove('menu-open');overview=true;navDirty=true;viewDirty=true;syncBackButton();moving=null;setCeiling(false);controls.enabled=true;camera.fov=43;camera.updateProjectionMatrix();camera.position.set(12.2,16.8,17.1);controls.target.set(3.45,.65,5.14);controls.update();
 $('#viewTitle').textContent='全屋鸟瞰';$('#modeTag').textContent='整体布局';$('#hint').textContent='拖动旋转户型 · 滚轮拉近 · 点击门开关';$('#overview').classList.add('active');
 document.querySelectorAll('[data-room],[data-focus]').forEach(b=>b.classList.remove('active'));message('顶面已收起，可查看三扇门的开启占位');
}
function init(){
 renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
 scene=new THREE.Scene();scene.background=new THREE.Color('#e8e2d9');
 camera=new THREE.PerspectiveCamera(72,1,.035,50);
 controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=35;controls.maxPolarAngle=Math.PI*.48;controls.enabled=false;
 const pmrem=new THREE.PMREMGenerator(renderer),env=new RoomEnvironment();
 let environmentTarget=pmrem.fromScene(env,.04);scene.environment=environmentTarget.texture;scene.environmentIntensity=.45;env.dispose();
 new HDRLoader().load('./assets/environment-v6.hdr',texture=>{
  texture.mapping=THREE.EquirectangularReflectionMapping;
  const next=pmrem.fromEquirectangular(texture);environmentTarget.dispose();environmentTarget=next;scene.environment=next.texture;
  viewDirty=true;scene.environmentRotation.y=THREE.MathUtils.degToRad(35);texture.dispose();pmrem.dispose();
 },undefined,()=>{pmrem.dispose();});
 scene.add(new THREE.HemisphereLight(0xfffaf2,0xb6a388,.68));
 const sun=new THREE.DirectionalLight(0xfff5e4,1.65);sun.position.set(1,12,-3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-7;sun.shadow.camera.right=7;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.camera.near=.1;sun.shadow.camera.far=30;sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;sun.shadow.radius=2;sun.shadow.blurSamples=8;sun.target.position.set(3.4,0,5);scene.add(sun,sun.target);
 for(const [id,x,y,z,power]of [['master',1.7,2.45,5.3,17],['second',5.3,2.45,3.4,17],['dining',5.65,2.20,6.5,19],['kitchen',5.5,2.45,9,17],['bath',2.6,2.45,9,12],['entry',4,2.45,8.6,9],['balcony',5,2.45,.7,8]]){
  const light=new THREE.SpotLight(0xffedda,power,5,1.35,.95,2);light.position.set(x,y,z);light.target.position.set(x,0,z);scene.add(light,light.target);
 }
 const bedside=new THREE.PointLight(0xffe6bb,1.8,1.3,2);bedside.position.set(.61,.69,3.98);scene.add(bedside);
 composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
 contactAO=new InteriorContactPass(scene,camera,512,512);contactAO.blendIntensity=.85;
 contactAO.updateGtaoMaterial({radius:.24,distanceExponent:1,thickness:.11,distanceFallOff:1,scale:1,samples:16});
 contactAO.updatePdMaterial({samples:8,radius:6,rings:2,lumaPhi:10,depthPhi:2,normalPhi:4});composer.addPass(contactAO);
 fxaa=new ShaderPass(FXAAShader);composer.addPass(fxaa);composer.addPass(new OutputPass());
 let initialQuality=matchMedia('(pointer:coarse)').matches?'smooth':'detail';try{initialQuality=localStorage.getItem('house-quality-v6')||initialQuality;}catch{}
 chooseQuality(initialQuality==='smooth'?'smooth':'detail');
 document.querySelectorAll('[data-quality]').forEach(b=>b.onclick=()=>chooseQuality(b.dataset.quality));
 new ResizeObserver(sizeView).observe(canvas);
 const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
 $('#loadingText').textContent='正在准备房间与可开关的门…';
 loader.load('./assets/apartment-doors-v7.glb',gltf=>{
  model=gltf.scene;scene.add(model);mixer=new THREE.AnimationMixer(model);
  model.traverse(o=>{
   if(o.name.startsWith('Ceiling_'))ceilingParts.push(o);
   if(o.isMesh){o.castShadow=true;o.receiveShadow=true;hits.push(o);for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(m.map)m.map.anisotropy=renderer.capabilities.getMaxAnisotropy();
    if(m.emissiveIntensity>2)m.emissiveIntensity=2;
    if(m.transparent){o.castShadow=false;m.depthWrite=false;}
   }}
  });
  for(const [id,info] of Object.entries(doorInfo)){
   const node=model.getObjectByName(id);const clip=gltf.animations.find(a=>a.name===id+'_Open');
   if(!node||!clip)throw new Error('缺少'+info.label+'的动作');
   const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;
   doors[id]={node,action,duration:clip.duration,t:0,target:0,moving:false};
   node.traverse(o=>{if(o.isMesh)o.userData.doorId=id;});
  }
  mixer.update(0);renderer.shadowMap.needsUpdate=true;ready=true;document.querySelectorAll('[data-needs-model]').forEach(b=>b.disabled=false);$('#loading').hidden=true;
  goDoor('Door_Master');updateButtons();message('房屋已就绪 · 点门打开，再点击进入房间');animate();
 },progress=>{const mb=(progress.loaded/1048576).toFixed(1);$('#loadingText').textContent='正在载入三维房屋… '+mb+' MB';},err=>{console.error(err);$('#loadingText').textContent='三维画面加载失败，请关闭页面后重新打开。';$('#loading').classList.add('error');});
}
function animate(){
 requestAnimationFrame(animate);const now=performance.now();const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;let any=false;
 for(const [id,d] of Object.entries(doors)){
  if(d.moving){d.elapsed+=dt;const u=Math.min(d.elapsed/.95,1);const eased=u*u*(3-2*u);d.t=d.start+(d.target-d.start)*eased;d.action.time=d.t;
   if(u===1){d.moving=false;navDirty=true;viewDirty=true;message(doorInfo[id].label+(d.target?'已打开':'已关闭'));updateButtons();}
   any=true;
  }
 }
 if(any){mixer.update(0);renderer.shadowMap.needsUpdate=true;}
 if(journey){
  const trip=journey;trip.elapsed+=dt;const raw=Math.min(trip.elapsed/trip.duration,1),u=raw*raw*(3-2*raw);camera.position.copy(trip.curve.getPoint(u));camera.quaternion.slerpQuaternions(trip.startRotation,trip.endRotation,u);
  if(raw===1){journey=null;goIndoor(trip.end,trip.target,rooms[trip.destination].name,null,trip.destination);message('已'+trip.label+(Object.values(ROUTES).some(r=>r.room===trip.destination)?' · 拖动画面环视，点「看门口」可返回':' · 可继续打开其他房门'));}
 }
 const orbitChanged=overview&&controls.update();updatePortals(now);if(any||journey||orbitChanged||viewDirty){composer.render(dt);viewDirty=false;}
}
function hitDoor(e){
 const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
 const isVisible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
 const found=raycaster.intersectObjects(hits,false).find(h=>isVisible(h.object)&&h.object.material?.opacity!==0);
 return found?.object.userData.doorId||null;
}
canvas.addEventListener('pointerdown',e=>{if(!ready||journey)return;drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
 if(!ready||journey)return;
 if(drag){const dx=e.clientX-drag.lastX,dy=e.clientY-drag.lastY;drag.lastX=e.clientX;drag.lastY=e.clientY;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
  if(!overview&&drag.moved){navDirty=true;viewDirty=true;yaw-=dx*.004;pitch=THREE.MathUtils.clamp(pitch-dy*.004,-1.25,1.25);camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))));}
 }else canvas.style.cursor=hitDoor(e)?'pointer':(overview?'grab':'move');
});
canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved&&!journey){const portal=hitPassage(e),id=hitDoor(e);if(portal)traverseDoor(portal);else if(id){if(canPassDoor(doors[id])&&routeAvailable(id,currentRoom))traverseDoor(id);else toggleDoor(id);}}drag=null;});
canvas.addEventListener('pointercancel',()=>drag=null);
canvas.addEventListener('wheel',e=>{if(overview||!ready||journey)return;e.preventDefault();navDirty=true;viewDirty=true;camera.fov=THREE.MathUtils.clamp(camera.fov+e.deltaY*.025,38,90);camera.updateProjectionMatrix();},{passive:false});

document.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click',()=>toggleDoor(b.dataset.toggle)));
document.querySelectorAll('[data-focus]').forEach(b=>b.addEventListener('click',()=>goDoor(b.dataset.focus)));
document.querySelectorAll('[data-room]').forEach(b=>b.addEventListener('click',()=>{const r=rooms[b.dataset.room];goIndoor(r.pos,r.target,r.name);message(r.name+' · 拖动查看四周');}));
$('#overview').onclick=goOverview;
$('#openAll').onclick=()=>{for(const id in doors)setDoor(id,true);};$('#closeAll').onclick=()=>{for(const id in doors)setDoor(id,false);};
$('#fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(error){message('当前浏览器暂不支持全屏，可在系统浏览器打开。');$('#photoFull').textContent='全屏暂不可用';$('#fullscreen').textContent='全屏暂不可用';}};
$('#panorama').onclick=()=>{const overlay=$('#panoOverlay');overlay.hidden=false;const frame=$('#panoFrame');if(!frame.getAttribute('src'))frame.src='./tour.html?v=7';};
$('#closePano').onclick=()=>{$('#panoOverlay').hidden=true;if(!modelStarted)showPhoto();};
$('#mobileMenu').onclick=()=>document.body.classList.toggle('menu-open');
window.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#panoOverlay').hidden=true;document.body.classList.remove('menu-open');}});

function showSample(name){
 const master=name==='master';$('#sampleTitle').textContent=master?'主卧 · 软装与窗光':'餐厅 · 样板对比';
 $('#masterFigure').hidden=!master;$('#comparisonFigure').hidden=master;$('.compareControls').hidden=master;$('.compareNote').hidden=master;
 document.querySelectorAll('[data-sample]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sample===name)));
}
document.querySelectorAll('[data-sample]').forEach(b=>b.onclick=()=>showSample(b.dataset.sample));
function showPhoto(){
 showSample('dining');
 document.querySelector('#photoAfter').src=window.PHOTO_AFTER;
 document.querySelector('#photoBefore').src=window.PHOTO_BEFORE;
 document.querySelector('#photoOverlay').hidden=false;
}
function showCatalog(){
 document.querySelector('#catalogOverlay').hidden=false;
 const f=document.querySelector('#catalogFrame');if(!f.getAttribute('src'))f.src='./catalog.html';
}
document.querySelector('#photo').onclick=showPhoto;
document.querySelector('#catalog').onclick=showCatalog;
document.querySelector('#photoCatalog').onclick=showCatalog;
document.querySelector('#closePhoto').onclick=()=>{document.querySelector('#photoOverlay').hidden=true;ensureModel();};
document.querySelector('#closeCatalog').onclick=()=>document.querySelector('#catalogOverlay').hidden=true;
document.querySelector('#photoFull').onclick=()=>document.querySelector('#fullscreen').onclick();
document.querySelector('#compare').oninput=e=>{const value=Number(e.target.value);document.querySelector('#comparisonFigure').style.setProperty('--compare',value+'%');document.querySelector('.compareTag.left').hidden=value===0;document.querySelector('.compareTag.right').hidden=value===100;};
window.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelector('#photoOverlay').hidden=true;document.querySelector('#catalogOverlay').hidden=true;}});

let modelStarted=false;function ensureModel(){if(modelStarted)return;modelStarted=true;try{init();}catch(e){console.error(e);$('#loadingText').textContent='当前浏览器无法显示三维画面，请用新版 Edge、Chrome 或 Safari 打开。';$('#loading').classList.add('error');}}
window.addEventListener('keydown',e=>{if(e.key==='Escape')ensureModel();});

document.querySelector('#photoTour').onclick=()=>{document.querySelector('#photoOverlay').hidden=true;document.querySelector('#panorama').onclick();};

if(new URLSearchParams(location.search).get('walk')==='1')ensureModel();else showPhoto();

function syncBackButton(){
 const entry=Object.entries(ROUTES).find(([,r])=>r.room===currentRoom);
 backToDoor.hidden=overview||!ready||!entry;backToDoor.disabled=Boolean(journey);
 if(entry)backToDoor.textContent=focusDoor===entry[0]?'看看房间':'看门口';
 document.querySelector('.mode-note').hidden=!backToDoor.hidden;
}
function traverseDoor(id){
 if(!ready||journey||!canPassDoor(doors[id])||!routeAvailable(id,currentRoom))return;
 const step=crossing(id,currentRoom),r=ROUTES[id];
 if(focusDoor!==id)goDoor(id);
 const points=step.points.map(p=>new THREE.Vector3(...p));points[0].copy(camera.position);
 const targetCamera=camera.clone();targetCamera.position.copy(points.at(-1));targetCamera.lookAt(new THREE.Vector3(...step.target));
 const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
 journey={curve,elapsed:0,duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? .2 : Math.min(1.8,Math.max(1.1,curve.getLength()/.95)),startRotation:camera.quaternion.clone(),endRotation:targetCamera.quaternion.clone(),end:step.points.at(-1),target:step.target,destination:step.destination,label:step.label};
 drag=null;navDirty=true;viewDirty=true;updateButtons();syncBackButton();message('正在'+step.label+'…');$('#viewTitle').textContent='前往'+step.name;$('#hint').textContent='正在穿过门口';
 for(const portal of portals.values())portal.hidden=true;
}
const navRay=new THREE.Raycaster();
function visibleMesh(object){for(let p=object;p;p=p.parent)if(!p.visible)return false;const materials=Array.isArray(object.material)?object.material:[object.material];return materials.some(m=>m&&(!m.transparent||m.opacity>.45));}
function anchorFor(id){const r=ROUTES[id],inside=currentRoom===r.room;return new THREE.Vector3(...r.center).addScaledVector(new THREE.Vector3(...r.normal),inside?.18:-.18);}
function updatePortals(now){
 if(!ready||overview||journey){for(const p of portals.values())p.hidden=true;return;}
 if(!navDirty&&now-lastNavAt<1000)return;if(now-lastNavAt<90)return;navDirty=false;lastNavAt=now;
 const rect=canvas.getBoundingClientRect();
 for(const [id,p]of portals){
  p.hidden=true;if(!canPassDoor(doors[id])||!routeAvailable(id,currentRoom))continue;
  const anchor=anchorFor(id),delta=anchor.clone().sub(camera.position),distance=delta.length();if(distance>3.3||distance<.15)continue;
  const screen=anchor.clone().project(camera);if(screen.z< -1||screen.z>1||Math.abs(screen.x)>.9||Math.abs(screen.y)>.85)continue;
  navRay.set(camera.position,delta.normalize());navRay.far=distance-.06;
  const blocked=navRay.intersectObjects(hits,false).some(h=>visibleMesh(h.object)&&!h.object.userData.doorId);if(blocked)continue;
  const step=crossing(id,currentRoom);p.textContent=step.label;p.setAttribute('aria-label','穿过门口'+step.label);p.style.left=((screen.x+1)*rect.width/2)+'px';p.style.top=((-screen.y+1)*rect.height/2)+'px';p.hidden=false;
 }
}
function hitPassage(event){
 if(!ready||journey||overview)return null;
 const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
 const obstruction=raycaster.intersectObjects(hits,false).find(h=>visibleMesh(h.object)&&!h.object.userData.doorId);
 let picked=null,best=Infinity;
 for(const [id,r]of Object.entries(ROUTES)){
  if(!canPassDoor(doors[id])||!routeAvailable(id,currentRoom))continue;
  const normal=new THREE.Vector3(...r.normal),center=new THREE.Vector3(...r.center),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,center),point=raycaster.ray.intersectPlane(plane,new THREE.Vector3());if(!point)continue;
  const widthOffset=r.normal[0]?Math.abs(point.z-center.z):Math.abs(point.x-center.x),distance=point.distanceTo(camera.position);
  if(widthOffset>r.width/2-.035||point.y<.08||point.y>2.0||distance>3.3||distance>=best)continue;
  if(obstruction&&obstruction.distance<distance-.08)continue;picked=id;best=distance;
 }
 return picked;
}

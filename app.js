const P=[
{n:1,id:"mu0f8jg89iqdk5",name:"อาคาร 32",desc:"ถังขยะแยกประเภท",x:41.135,y:55.741},
{n:2,id:"mu0fd3kduzflh5",name:"ข้างอาคาร 22",desc:"ถังขยะแยกประเภท",x:77.915,y:53.897},
{n:3,id:"mu0fi90w8likrg",name:"อาคาร 27",desc:"ถังขยะแยกประเภท",x:38.129,y:67.363},
{n:4,id:"mu0flpiwazkdz9",name:"อาคาร 11",desc:"ถังขยะแยกประเภท",x:59.024,y:61.472},
{n:5,id:"mu9oql7p91fx18",name:"สนามวอลเล่ย์บอล",desc:"ถังขยะแยกประเภท",x:38.55,y:10.989},
{n:6,id:"mu9oupvubhful0",name:"อาคาร 13",desc:"ถังขยะแยกประเภท",x:78.568,y:58.087},
{n:7,id:"mu9oyrmofx1i0y",name:"อาคาร 38",desc:"ถังขยะแยกประเภท",x:60.685,y:56.393},
{n:8,id:"mu9p22eeagneg0",name:"อาคาร 36",desc:"ถังขยะแยกประเภท",x:49.805,y:78.462},
{n:9,id:"mu9p4ryqk72n0j",name:"สนามวิ่ง 1",desc:"ถังขยะแยกประเภท",x:51.03,y:24.631},
{n:10,id:"mu9p6vpkz5y50s",name:"โดมสนามกีฬา",desc:"ถังขยะแยกประเภท",x:48.8,y:40.504}
];

// Inline SVG icons keep the interface independent of icon fonts and emoji.
const paths = {
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  leaf:'<path d="M20 3C10 2 3 6 3 13a7 7 0 0 0 7 7c7 0 11-7 10-17ZM3 22 15 10"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',play:'<path d="m8 4 12 8-12 8Z"/>',
  recycle:'<path d="m8 7 4-5 4 7M12 9h4V5M18 12l4 7h-8m2-3-3 3 3 3M9 19H2l4-7m-3 1 3-2 2 3"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Explicit inventory avoids dozens of failing photo requests for every location.
// Add future photo paths here, in their desired slideshow order.
const photoFiles = {
  1:['1.jpeg','1-1.jpeg'],2:['2.jpeg','2-1.jpeg'],3:['3.jpeg','3-1.jpeg'],
  4:['4.jpeg'],5:['5.jpeg'],6:['6.jpeg'],7:['7.jpeg'],8:['8.jpeg'],
  9:['9.jpeg','9-1.jpeg'],10:['10.jpeg','10-1.jpeg']
};
let active = null, photos = [], photoIndex = 0, timer = null, paused = false;
let requestVersion = 0, opener = null;
const dialog = $('detail');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function renderList() {
  const query = $('q').value.trim().toLocaleLowerCase();
  const visible = P.filter(p => `${p.n} ${p.name} ${p.desc}`.toLocaleLowerCase().includes(query));
  $('results').textContent = `${visible.length} จุด`;
  $('list').innerHTML = visible.length ? visible.map(p => `<button class="card${active === p.id ? ' active' : ''}" data-id="${p.id}" aria-label="ดูภาพจุด ${p.n} ${esc(p.name)}"><span class="number">${String(p.n).padStart(2,'0')}</span><span class="card-copy"><strong>${esc(p.name)}</strong><small>${esc(p.desc)}</small></span>${icon('right')}</button>`).join('') : '<div class="empty" role="status">ไม่พบตำแหน่งที่ค้นหา<br>ลองค้นหาชื่ออาคารหรือหมายเลขจุด</div>';
  const ids = new Set(visible.map(p => p.id));
  document.querySelectorAll('.pin').forEach(pin => {
    pin.classList.toggle('filtered', !ids.has(pin.dataset.id));
    pin.classList.toggle('active', active === pin.dataset.id);
  });
}
function stopTimer() { clearInterval(timer); timer = null; document.dispatchEvent(new CustomEvent('campus:playback', {detail:{playing:false}})); }
function startTimer() {
  stopTimer();
  if (dialog.open && photos.length > 1 && !paused && !document.hidden) {
    timer = setInterval(() => showPhoto(photoIndex + 1), 3000);
    document.dispatchEvent(new CustomEvent('campus:playback', {detail:{playing:true}}));
  }
}
function showPhoto(index) {
  if (!photos.length) return;
  photoIndex = (index + photos.length) % photos.length;
  const event = new CustomEvent('campus:photo', {cancelable:true, detail:{index:photoIndex}});
  document.dispatchEvent(event);
  if (!event.defaultPrevented) $('slides').querySelectorAll('.slide').forEach((slide,i) => {
    slide.classList.toggle('current', i === photoIndex);
    slide.setAttribute('aria-hidden', String(i !== photoIndex));
  });
  $('dots').querySelectorAll('button').forEach((dot,i) => dot.setAttribute('aria-current', String(i === photoIndex)));
  $('photo-count').textContent = `ภาพ ${photoIndex + 1} / ${photos.length}`;
}
function changePhoto(index) { showPhoto(index); startTimer(); }
function updatePause() {
  $('pause').innerHTML = icon(paused ? 'play' : 'pause');
  $('pause').setAttribute('aria-label', paused ? 'เริ่มสไลด์อัตโนมัติ' : 'หยุดสไลด์อัตโนมัติ');
  $('pause').setAttribute('aria-pressed', String(paused));
  $('gallery-hint').textContent = photos.length > 1 ? (paused ? 'แสดงเต็มภาพ · หยุดสไลด์อัตโนมัติแล้ว' : 'แสดงเต็มภาพ · เลื่อนอัตโนมัติทุก 3 วินาที') : 'แสดงภาพสถานที่จริงแบบเต็มภาพ';
  startTimer();
}
function renderGallery(point) {
  const event = new CustomEvent('campus:gallery', {cancelable:true, detail:{point, photos}});
  document.dispatchEvent(event);
  if (!event.defaultPrevented) $('slides').innerHTML = photos.map((src,i) => `<img class="slide" src="${src}" alt="${esc(point.name)} ภาพที่ ${i + 1}" aria-hidden="true">`).join('');
  $('dots').innerHTML = photos.length > 1 ? photos.map((_,i) => `<button class="dot" aria-label="ดูภาพที่ ${i + 1}" data-index="${i}"></button>`).join('') : '';
  $('photo-empty').hidden = photos.length > 0;
  $('photo-empty').querySelector('p').textContent = 'ยังไม่มีรูปตำแหน่งนี้';
  $('photo-count').textContent = photos.length ? '' : 'ไม่มีรูปภาพ';
  ['previous','next','pause'].forEach(id => { $(id).hidden = photos.length < 2; });
  showPhoto(0);
  updatePause();
}
function loadImage(src) {
  return new Promise(resolve => {
    const image = new Image();
    const timeout = setTimeout(() => done(null), 12000);
    function done(value) { clearTimeout(timeout); image.onload = image.onerror = null; resolve(value); }
    image.onload = () => done(src);
    image.onerror = () => done(null);
    image.src = src;
  });
}
async function openPoint(id, trigger) {
  const point = P.find(p => p.id === id);
  if (!point) return;
  const version = ++requestVersion;
  stopTimer(); active = id; photos = []; photoIndex = 0; paused = reducedMotion.matches;
  opener = trigger;
  $('point-title').textContent = point.name;
  $('point-number').textContent = `จุดที่ ${String(point.n).padStart(2,'0')}`;
  $('point-description').textContent = point.desc;
  renderGallery(point);
  $('photo-empty').querySelector('p').textContent = 'กำลังโหลดภาพสถานที่…';
  $('gallery').setAttribute('aria-busy','true');
  // Keep the invoking list button in the DOM so native dialog focus restoration works.
  document.querySelectorAll('.card,.pin').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  if (!dialog.open) dialog.showModal();
  document.body.style.overflow = 'hidden';
  const loaded = await Promise.all((photoFiles[point.n] || []).map(file => loadImage(`image/${file}`)));
  if (version !== requestVersion || !dialog.open) return;
  photos = loaded.filter(Boolean);
  $('gallery').setAttribute('aria-busy','false');
  renderGallery(point);
}
P.forEach(point => {
  const pin = document.createElement('button');
  pin.className = 'pin'; pin.dataset.id = point.id;
  pin.style.left = `${point.x}%`; pin.style.top = `${point.y}%`;
  pin.textContent = point.n;
  pin.setAttribute('aria-label',`ดูภาพจุด ${point.n} ${point.name}`);
  pin.addEventListener('click', () => openPoint(point.id, pin));
  $('wrap').append(pin);
});
$('count').textContent = P.length;
$('list').addEventListener('click', event => {
  const card = event.target.closest('.card');
  if (card) openPoint(card.dataset.id, card);
});
$('q').addEventListener('input', renderList);
$('reset').addEventListener('click', () => {
  $('q').value = ''; active = null; renderList();
  $('map-scroll').scrollTo({left:0,top:0,behavior:reducedMotion.matches ? 'instant' : 'smooth'});
});
$('previous').addEventListener('click', () => changePhoto(photoIndex - 1));
$('next').addEventListener('click', () => changePhoto(photoIndex + 1));
$('dots').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button) changePhoto(Number(button.dataset.index));
});
$('pause').addEventListener('click', () => { paused = !paused; updatePause(); });
$('close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  ++requestVersion; stopTimer(); document.body.style.overflow = '';
  if (opener?.isConnected) opener.focus({preventScroll:true});
});
dialog.addEventListener('click', event => { if (event.target === dialog) {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}});
dialog.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight') { event.preventDefault(); changePhoto(photoIndex + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); changePhoto(photoIndex - 1); }
});
let touchStart = null;
$('gallery').addEventListener('touchstart', event => { touchStart = event.touches[0].clientX; }, {passive:true});
$('gallery').addEventListener('touchend', event => {
  if (touchStart === null) return;
  const delta = event.changedTouches[0].clientX - touchStart;
  if (Math.abs(delta) > 50) changePhoto(photoIndex + (delta < 0 ? 1 : -1));
  touchStart = null;
}, {passive:true});
document.addEventListener('visibilitychange', startTimer);
reducedMotion.addEventListener('change', event => { if (event.matches) { paused = true; updatePause(); } });
renderList();

document.addEventListener('campus:motion-ready', () => {
  if (dialog.open && active) { const index = photoIndex; renderGallery(P.find(p => p.id === active)); showPhoto(index); }
});

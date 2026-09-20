import { Component, lazy, Suspense, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import ClickSpark from './components/ClickSpark';
import CardSwap from './components/CardSwap';
import SplitText from './components/SplitText';
import './motion.css';

const ShapeBlur = lazy(() => import('./components/ShapeBlur'));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const richScreen = matchMedia('(min-width: 900px) and (pointer: fine)');
const subscribe = notify => { reduced.addEventListener('change', notify); richScreen.addEventListener('change', notify); return () => {reduced.removeEventListener('change', notify); richScreen.removeEventListener('change', notify);}; };
const snapshot = () => `${reduced.matches}:${richScreen.matches}`;

class OptionalEffect extends Component {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed ? null : this.props.children; }
}
function Heading() {
  useSyncExternalStore(subscribe, snapshot);
  return <><SplitText text="ทิ้งให้ถูกจุด" reduced={reduced.matches} /><SplitText className="hero-second-line" text="เพื่อมหาวิทยาลัยของเรา" delay={.12} reduced={reduced.matches} /></>;
}
function HeroShape() {
  useSyncExternalStore(subscribe, snapshot);
  return !reduced.matches && richScreen.matches ? <OptionalEffect><Suspense fallback={null}><ShapeBlur /></Suspense></OptionalEffect> : null;
}
createRoot(document.getElementById('animated-heading')).render(<Heading />);
createRoot(document.getElementById('hero-shape')).render(<HeroShape />);
createRoot(document.getElementById('page-sparks')).render(<ClickSpark />);
createRoot(document.getElementById('dialog-sparks')).render(<ClickSpark scope="dialog" />);

// React owns only #slides once the enhancer is ready; the map/search remain plain JS.
let galleryRoot, galleryState = {photos:[], index:0, title:''};
const renderCards = () => {
  galleryRoot ||= createRoot(document.getElementById('slides'));
  galleryRoot.render(<CardSwap key={galleryState.title} {...galleryState} reduced={reduced.matches} />);
};
const progress = document.getElementById('slide-progress');
let progressAnimation, playing = false;
function updateProgress() {
  progressAnimation?.cancel();
  if (playing && !reduced.matches && galleryState.photos.length > 1 && !document.hidden) {
    progressAnimation = progress.animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:3000,easing:'linear',fill:'forwards'});
  }
}
document.addEventListener('campus:gallery', event => {
  event.preventDefault();
  galleryState = {photos:event.detail.photos, index:0, title:event.detail.point.name};
  renderCards();
});
document.addEventListener('campus:photo', event => {
  event.preventDefault(); galleryState.index = event.detail.index; renderCards(); updateProgress();
});
document.addEventListener('campus:playback', event => {playing = event.detail.playing; updateProgress();});
document.getElementById('detail').addEventListener('close', () => {
  galleryRoot?.render(null); playing = false; updateProgress();
});
reduced.addEventListener('change', () => { if (document.getElementById('detail').open) renderCards(); updateProgress(); });
// Handle a user who opened photos before the optional bundle finished loading.
document.dispatchEvent(new Event('campus:motion-ready'));

// Spotlight is restricted to hover-capable pointers; no frame loop while idle.
const sidebar = document.querySelector('.sidebar');
sidebar.addEventListener('pointermove', event => {
  if (reduced.matches || event.pointerType !== 'mouse') return;
  const card = event.target.closest('.card');
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty('--pointer-x', `${event.clientX - rect.left}px`);
  card.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
}, {passive:true});

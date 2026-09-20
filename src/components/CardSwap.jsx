// Adapted from React Bits CardSwap (promt.txt): GSAP depth slots and card promotion.
// The existing gallery owns the 3-second timer, pause state and active index.
import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';

export default function CardSwap({ photos, index = 0, title, reduced = false }) {
  const container = useRef(null);
  const previous = useRef(index);
  useLayoutEffect(() => {
    const cards = [...container.current.children];
    const last = previous.current;
    const animated = !reduced && last !== index && photos.length > 1;
    const context = gsap.context(() => {
      cards.forEach((card, i) => {
        const slot = (i - index + cards.length) % cards.length;
        const depth = Math.min(slot, 2);
        const target = {x: depth * 7, y: -depth * 9, scale: 1 - depth * .035, rotation: depth * 1.1, opacity: slot < 3 ? 1 : 0, zIndex: cards.length - slot};
        if (!animated) { gsap.set(card, target); return; }
        if (i === last) {
          gsap.timeline().to(card, {y: 34, x: -12, rotation: -3, scale: .94, opacity: 0, duration: .2, ease: 'power2.in'})
            .set(card, { ...target, opacity: 0 })
            .to(card, {opacity: target.opacity, duration: .22, ease: 'power2.out'});
        } else {
          gsap.to(card, {...target, duration: .55, ease: 'power3.out'});
        }
      });
    }, container);
    previous.current = index;
    // Kill interrupted transitions without reverting the current visual position.
    return () => { context.getTweens().forEach(tween => tween.kill()); };
  }, [photos, index, reduced]);
  return <div className="photo-deck" ref={container}>
    {photos.map((src, i) => <div key={src} className={`photo-card${i === index ? ' is-front' : ''}`} aria-hidden={i !== index}>
      <img src={src} alt={`${title} ภาพที่ ${i + 1}`} draggable="false" />
    </div>)}
  </div>;
}

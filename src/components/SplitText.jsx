// React Bits SplitText adapted from the supplied JS-CSS source.
import { useRef } from 'react';
import { gsap } from 'gsap';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(GSAPSplitText, useGSAP);

export default function SplitText({text, className = '', delay = 0, reduced = false}) {
  const ref = useRef(null);
  useGSAP(() => {
    if (reduced) return;
    let split, cancelled = false;
    const ready = document.fonts?.ready || Promise.resolve();
    ready.then(() => {
      if (cancelled || !ref.current) return;
      // Words/lines preserve Thai combining marks; never split UTF-16 code units.
      split = GSAPSplitText.create(ref.current, {
        type: 'words,lines', autoSplit: true, aria: 'auto',
        onSplit: self => gsap.from(self.words, {opacity: 0, y: 18, filter: 'blur(4px)', delay, duration: .8, stagger: .09, ease: 'power3.out'})
      });
    });
    return () => { cancelled = true; split?.revert(); };
  }, {scope: ref, dependencies: [text, delay, reduced], revertOnUpdate: true});
  return <span className={className} ref={ref}>{text}</span>;
}

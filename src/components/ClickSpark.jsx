// React Bits ClickSpark, adapted from the JS-CSS registry source.
// Uses its radial line geometry and easing, with scoped events and on-demand RAF.
import { useEffect, useRef } from 'react';

export default function ClickSpark({ scope = 'page', sparkColor = '#fff', sparkSize = 10, sparkRadius = 15, sparkCount = 8, duration = 400 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let sparks = [], frame = 0;
    const clear = () => {
      cancelAnimationFrame(frame); frame = 0; sparks = [];
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
    const draw = now => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      sparks = sparks.filter(spark => {
        const progress = (now - spark.startTime) / duration;
        if (progress >= 1) return false;
        const eased = progress * (2 - progress);
        const distance = eased * sparkRadius, length = sparkSize * (1 - eased);
        context.strokeStyle = spark.color;
        context.lineWidth = 2;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(spark.x + distance * Math.cos(spark.angle), spark.y + distance * Math.sin(spark.angle));
        context.lineTo(spark.x + (distance + length) * Math.cos(spark.angle), spark.y + (distance + length) * Math.sin(spark.angle));
        context.stroke();
        return true;
      });
      frame = sparks.length ? requestAnimationFrame(draw) : 0;
    };
    const click = event => {
      if (motion.matches || document.hidden) return;
      const button = event.target.closest('button, a');
      if (!button || button.disabled) return;
      const inDialog = !!button.closest('dialog');
      if (inDialog !== (scope === 'dialog')) return;
      const rect = canvas.getBoundingClientRect(), target = button.getBoundingClientRect();
      const x = (event.detail ? event.clientX : target.left + target.width / 2) - rect.left;
      const y = (event.detail ? event.clientY : target.top + target.height / 2) - rect.top;
      const color = button.matches('.pin,.gallery-arrow') ? sparkColor : '#bb934d';
      sparks = sparks.slice(-56).concat(Array.from({ length: sparkCount }, (_, i) => ({x, y, color, angle: 2 * Math.PI * i / sparkCount, startTime: performance.now()})));
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const visibility = () => { if (document.hidden) clear(); };
    document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', clear);
    return () => { clear(); document.removeEventListener('click', click, true); document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', clear); };
  }, [scope, sparkColor, sparkSize, sparkRadius, sparkCount, duration]);
  return <canvas ref={ref} className="click-spark-canvas" aria-hidden="true" />;
}

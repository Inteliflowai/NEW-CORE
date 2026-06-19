'use client';

import { useEffect, useRef, useState } from 'react';

const SLIDES = [
  { src: '/images/login/login-classroom-ai.jpg', caption: 'The future of education is brilliantly personal.' },
  { src: '/images/login/login-student-before-after.jpg', caption: 'Every student has the potential to transform.' },
  { src: '/images/login/login-brain-ai.jpg', caption: 'Intelligence flows in every direction.' },
  { src: '/images/login/login-learning-paths.jpg', caption: 'Every mind is an explosion waiting to happen.' },
  { src: '/images/login/login-student-discovery.jpg', caption: 'Learning is the most colorful adventure.' },
];
const INTERVAL = 7000;

export default function BackgroundRotator() {
  const [current, setCurrent] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => setCurrent((c) => (c + 1) % SLIDES.length), INTERVAL);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [current]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: 'var(--ink-950)' }}>
      {SLIDES.map((s, i) => (
        <div
          key={s.src}
          aria-hidden
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
          style={{ backgroundImage: `url(${s.src})`, opacity: i === current ? 1 : 0 }}
        />
      ))}
      {/* Scrim for caption legibility (Tier-1 primitive — sanctioned per spec G3). */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, var(--ink-950) 0%, transparent 55%)' }}
      />
      <p
        className="absolute bottom-16 left-8 right-8 text-lg font-display"
        data-active="true"
        style={{ color: 'var(--white)', textShadow: '0 1px 8px rgb(0 0 0 / 0.6)' }}
      >
        {SLIDES[current].caption}
      </p>
      <div role="tablist" aria-label="Slideshow" className="absolute bottom-8 right-8 flex gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.src}
            role="tab"
            type="button"
            aria-selected={i === current}
            aria-label={`Slide ${i + 1} of ${SLIDES.length}`}
            onClick={() => setCurrent(i)}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === current ? '20px' : '6px',
              backgroundColor: 'var(--white)',
              opacity: i === current ? 0.9 : 0.35,
            }}
          />
        ))}
      </div>
    </div>
  );
}

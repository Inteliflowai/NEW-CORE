'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

// Full-bleed pop-art gallery, borrowed from SPARK's login — edge-to-edge, with a
// slow Ken Burns drift + cross-fade. These are the first impression, so they're
// the hero: object-cover fills the viewport (no letterbox) and next/image keeps the
// large PNGs optimized.
const SLIDES = [
  { src: '/images/login/spark-slide-1.png', caption: 'Where curiosity catches fire.' },
  { src: '/images/login/spark-slide-2.png', caption: 'Every mind is an explosion waiting to happen.' },
  { src: '/images/login/spark-slide-3.png', caption: 'Learning, in full color.' },
  { src: '/images/login/spark-slide-4.jpg', caption: 'Bold ideas, brilliantly personal.' },
  { src: '/images/login/spark-slide-5.png', caption: 'The spark that changes everything.' },
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
        <Image
          key={s.src}
          src={s.src}
          alt=""
          aria-hidden
          fill
          priority={i === 0}
          sizes="100vw"
          className={`object-cover ${i === current ? 'scale-105 opacity-100' : 'scale-100 opacity-0'}`}
          // Opacity cross-fade + slow Ken Burns zoom on the transform.
          style={{ transition: 'opacity 1.4s ease, transform 8s ease' }}
        />
      ))}
      {/* Diagonal + bottom scrims (token-derived translucent ink) so the white billboard
          text and caption stay legible over busy art. Sanctioned per spec G3. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(105deg, color-mix(in srgb, var(--ink-950) 55%, transparent) 0%, color-mix(in srgb, var(--ink-950) 12%, transparent) 38%, transparent 60%)' }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, color-mix(in srgb, var(--ink-950) 70%, transparent) 0%, transparent 35%)' }}
      />
      <p
        className="absolute bottom-8 left-8 right-8 hidden max-w-md font-display text-2xl font-bold sm:left-10 sm:block"
        data-active="true"
        style={{ color: 'var(--white)', textShadow: '0 2px 14px rgb(0 0 0 / 0.75)' }}
      >
        {SLIDES[current].caption}
      </p>
      <div role="tablist" aria-label="Slideshow" className="absolute bottom-4 left-8 z-10 flex gap-2 sm:left-10">
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
              width: i === current ? '24px' : '7px',
              backgroundColor: 'var(--white)',
              opacity: i === current ? 0.95 : 0.4,
            }}
          />
        ))}
      </div>
    </div>
  );
}

'use client';

// The signature moment, made to feel ALIVE: the coach NOTICES, SPEAKS, INVITES,
// then DEFERS — one four-beat heartbeat, three emotional registers. Mock data,
// no real signals. Motion comes from the shared coachMotion module (single
// source of motion truth); colour from data-role / data-intensity.
// prefers-reduced-motion snaps every beat to its end state. Token-only (no hardcoded hex).
import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { REGISTERS, ORDER, type RegisterKey } from './_registers';
import {
  COACH_MOTION,
  coachTransition,
  coachContainerVariants,
  coachMarkVariants,
  coachRiseVariants,
  coachSparkVariants,
} from '@/lib/design/coachMotion';

export function SignatureMoment(): React.JSX.Element {
  const [key, setKey] = useState<RegisterKey>('teacher');
  const [run, setRun] = useState(0); // remount counter → replay
  const [acted, setActed] = useState<null | 'yes' | 'dismiss'>(null);
  const reduce = useReducedMotion();
  const r = REGISTERS[key];
  const cfg = COACH_MOTION[key];

  function select(k: RegisterKey) { setKey(k); setActed(null); setRun((x) => x + 1); }
  function replay() { setActed(null); setRun((x) => x + 1); }

  // NOTICE: the coach-mark leans in (x/rotate) and squares up. SPEAK + INVITE rise after it.
  const container = coachContainerVariants(!!reduce, cfg);
  const coachMark = coachMarkVariants(!!reduce, cfg);
  const riseV = coachRiseVariants(!!reduce, cfg);
  const sparkV = coachSparkVariants(!!reduce);

  return (
    <div
      data-role={r.role}
      data-intensity={r.intensity}
      className="pop-canvas flex w-full max-w-xl flex-col items-stretch gap-6 rounded-lg bg-bg p-6"
    >
      {/* Register toggle */}
      <div role="group" aria-label="Register" className="flex gap-2">
        {ORDER.map((k) => {
          const active = k === key;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => select(k)}
              className={`flex-1 rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm font-bold shadow-sticker transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                active ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg hover:bg-brand-surface'
              }`}
            >
              {REGISTERS[k].label}
            </button>
          );
        })}
      </div>

      {/* Target feeling */}
      <p className="text-fg-muted text-center text-[11px] font-bold uppercase tracking-[0.18em]">{r.feeling}</p>

      {/* The moment (fixed min-height so the calm/exit doesn't jump the layout) */}
      <div className="relative flex min-h-44 items-center justify-center">
        <AnimatePresence mode="wait">
          {acted === null ? (
            <motion.div
              key={`card-${key}-${run}`}
              variants={container}
              initial="hidden"
              animate="show"
              exit="defer"
              className="w-full rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-pop"
            >
              <div className="flex items-start gap-3">
                <motion.div
                  variants={coachMark}
                  className="relative grid size-11 shrink-0 place-items-center rounded-full border-2 border-sidebar-edge bg-brand font-display text-lg font-extrabold text-fg-on-brand shadow-sticker"
                >
                  {r.coachLabel}
                  {r.celebratory && (
                    <motion.span
                      variants={sparkV}
                      aria-hidden="true"
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border-2 border-sidebar-edge bg-sidebar-active text-[10px] text-sidebar-active-fg shadow-sticker"
                    >
                      ✦
                    </motion.span>
                  )}
                </motion.div>

                <div className="flex flex-col gap-3">
                  <motion.p variants={riseV} className="font-display text-lg font-semibold leading-snug text-fg">
                    {r.line}
                  </motion.p>
                  <motion.div variants={riseV} className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActed('yes')}
                      className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-1.5 text-sm font-bold text-fg-on-brand shadow-sticker transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      {r.yes}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActed('dismiss')}
                      className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-sm font-bold text-fg shadow-sticker transition-colors hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      {r.dismiss}
                    </button>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          ) : (
            // DEFER: the calm afterward.
            <motion.p
              key="calm"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={coachTransition(!!reduce, { duration: r.rise.duration, ease: r.rise.ease })}
              className="text-fg-muted text-center text-sm"
            >
              {acted === 'yes' ? r.acceptedNote : r.dismissedNote}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Replay */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={replay}
          className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-1.5 text-sm font-bold text-fg shadow-sticker transition-colors hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          ↻ Replay the moment
        </button>
      </div>
    </div>
  );
}

export default SignatureMoment;

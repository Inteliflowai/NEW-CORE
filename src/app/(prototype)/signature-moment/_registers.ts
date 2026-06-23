// The three emotional registers for the signature "coach notices and speaks"
// moment. Same four-beat, three feelings. Motion is pulled from the design-token
// SoT (src/lib/design/tokens.ts → motion), colours from the role/intensity
// theming (data-role / data-intensity). Copy lines are DRAFT → Barb
// (STRINGS-FOR-BARB.md §Signature-Moment).
import type { Transition } from 'framer-motion';
import { motion as MT } from '@/lib/design/tokens';

export type RegisterKey = 'student' | 'teacher' | 'parent';

export interface Register {
  key: RegisterKey;
  label: string;
  role: 'student' | 'teacher' | 'parent';
  intensity: 'loud' | 'calm';
  feeling: string;        // target feeling (eyebrow)
  coachLabel: string;     // initial shown on the coach-mark
  line: string;           // the ONE observation — plain words, no metrics (DRAFT → Barb)
  yes: string;            // the invitation (accept)
  dismiss: string;        // the quiet decline
  acceptedNote: string;   // the calm after acting
  dismissedNote: string;  // the calm after declining
  celebratory: boolean;   // student spark on SPEAK
  /** framer-motion transition for the coach-mark "lean-in". */
  entrance: Transition;
  /** framer-motion transition for the line + invite rise. */
  rise: { duration: number; ease: [number, number, number, number] };
  /** delay between beats. */
  stagger: number;
}

export const REGISTERS: Record<RegisterKey, Register> = {
  student: {
    key: 'student', label: 'Student', role: 'student', intensity: 'loud',
    feeling: 'Delight + momentum', coachLabel: 'C',
    line: "Nice — your writing's getting sharper. Want to level up your endings next?",
    yes: 'Show me how', dismiss: 'Maybe later',
    acceptedNote: "Let's go — one ending at a time.", dismissedNote: "All good — I'll be here.",
    celebratory: true,
    entrance: { ...MT.spring.playful },                 // a touch of bounce
    rise: { duration: MT.duration.base, ease: MT.ease.out },
    stagger: 0.14,
  },
  teacher: {
    key: 'teacher', label: 'Teacher', role: 'teacher', intensity: 'calm',
    feeling: 'Relief + competence', coachLabel: 'C',
    line: "Leila's cohesion dipped this week. Want a 5-minute reteach you can run tomorrow?",
    yes: 'Open the reteach', dismiss: 'Not now',
    acceptedNote: 'Ready for tomorrow.', dismissedNote: "Okay — I'll keep an eye on it.",
    celebratory: false,
    entrance: { duration: MT.duration.fast, ease: MT.ease.standard },   // fast, minimal
    rise: { duration: MT.duration.fast, ease: MT.ease.out },
    stagger: 0.08,
  },
  parent: {
    key: 'parent', label: 'Parent', role: 'parent', intensity: 'calm',
    feeling: 'Reassurance + pride', coachLabel: 'C',
    line: "Maya's reading is really coming along this month. Here's one small way to cheer her on at home.",
    yes: 'Show me the idea', dismiss: 'Maybe later',
    acceptedNote: "Here's the idea — small and doable.", dismissedNote: "No rush — she's doing well.",
    celebratory: false,
    entrance: { duration: MT.duration.slow, ease: MT.ease.out },        // gentle, soft
    rise: { duration: MT.duration.slow, ease: MT.ease.out },
    stagger: 0.18,
  },
};

export const ORDER: RegisterKey[] = ['student', 'teacher', 'parent'];

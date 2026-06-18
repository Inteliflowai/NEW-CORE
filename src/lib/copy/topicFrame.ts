// src/lib/copy/topicFrame.ts
// Copy register: frames a raw struggle topic as "still building" copy
// for student/parent surfaces (SCOPE §15 carry-forward B4).
// Pure helper — no Next.js / Supabase imports.

/**
 * Title-cases each word in a string.
 * "long division" → "Long Division"
 * "FRACTIONS" → "Fractions"
 */
function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Frames a raw struggle topic as encouraging "still building" copy.
 * Example: "fractions" → "still building: Fractions"
 * Never uses the word "struggle" in output.
 */
export function topicFrame(topic: string): string {
  return `still building: ${toTitleCase(topic.trim())}`;
}

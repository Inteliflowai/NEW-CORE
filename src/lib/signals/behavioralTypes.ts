/**
 * CORE V2 Behavioral Signal Types
 *
 * These types feed computeSignals() — the behavioral-signal computer for the
 * student quiz runner. They replace V1's raw StudentEvent[] stream with
 * pre-aggregated counts captured by the quiz runner at session end.
 *
 * V2 ADAPTATION RULE: V1's signalComputer.ts consumed a raw StudentEvent[]
 * array for frustration / attention / engagement. V2 uses SessionAggregates
 * (counts + totals) that the quiz runner captures during the session. No raw
 * event log is stored — only the aggregates needed by each signal.
 */

/** One question attempt within a session. Unchanged from V1 (same shape). */
export interface QuestionAttemptData {
  questionId: string;
  questionIndex: number;
  isCorrect: boolean;
  timeTakenMs: number;
  changeCount: number;   // how many times student changed their answer
  hintsUsed: number;
}

/**
 * Aggregate counts captured by the quiz runner over the full session.
 *
 * Fields with * were NOT in the brief's original SessionAggregates definition
 * but are required by V1 signal helpers after the per-signal verification gate
 * (Task 3, Step 0). They must be added to the quiz-runner capture logic
 * (Task 1 migration follow-up):
 *
 *   totalFocusLossMs* — needed by computeAttention() to measure away-fraction
 *                       (V1 summed focus_loss→focus_gain deltas; V2 captures
 *                        the total during session).
 *   backspaceCount*   — needed by computeFrustration() high-correction-rate signal
 *                       and computeEngagement() backspaceRate.
 *   keypressCount*    — denominator for backspaceRate in frustration + engagement.
 *   ttsPlayCount*     — needed by computeEngagement() exploratory style detection.
 *   canvasUsed*       — needed by computeEngagement() exploratory style detection.
 *   stuckEraseCount*  — needed by computeFrustration() stuck-and-erase sub-signal.
 *                       Runner computes it client-side: count of times a pause
 *                       >3000 ms is immediately followed by a backspace keystroke.
 *                       Default 0 until Phase 2/3 instrumentation lands.
 */
export interface SessionAggregates {
  focusLossCount: number;      // # of focus_loss events
  pasteCount: number;          // # of paste events
  pauseCount: number;          // # of pause events
  totalPauseMs: number;        // total ms spent in pauses
  // ── ADDED fields (not in brief — required by signal helpers) ──────────────
  totalFocusLossMs: number;    // total ms the window was blurred (sum of focus-loss gaps)
  backspaceCount: number;      // # of backspace/delete keystrokes
  keypressCount: number;       // # of total keypress events (incl. backspace)
  ttsPlayCount: number;        // # of TTS play events
  canvasUsed: boolean;         // whether the scratch-canvas was opened at all
  stuckEraseCount: number;     // # of pause>3000ms immediately followed by backspace (runner-captured; default 0)
}

/** Full session data passed to computeSignals(). Pure value — no DB access. */
export interface RawSessionData {
  studentId: string;
  sessionId: string;
  context: 'quiz' | 'homework' | 'tutor';
  schoolId: string | null;
  questionAttempts: QuestionAttemptData[];
  aggregates: SessionAggregates;
  sessionStartMs: number;
  sessionEndMs: number;
}

/** Output of computeSignals(). All 0–1 scores are clamped to [0,1]. */
export interface ComputedSignals {
  // Learning velocity
  learningVelocity: number;                             // correct answers / minute
  velocityTrend: 'accelerating' | 'stable' | 'decelerating';

  // Frustration (0–1)
  frustrationScore: number;
  frustrationIndicators: string[];

  // Attention (0–1, higher = more attentive)
  attentionScore: number;
  attentionGaps: number;                                // # of focus-loss events

  // Error pattern
  errorPatternType: 'careless' | 'conceptual' | 'procedural' | 'random' | 'insufficient_data';
  errorFrequency: number;                               // errors / total attempts (0–1)

  // Confidence calibration (0–1)
  confidenceScore: number;                              // inferred from response speed
  confidenceAccuracy: number;                           // how well speed predicts correctness

  // Engagement
  engagementScore: number;                              // 0–1
  engagementStyle: 'methodical' | 'impulsive' | 'exploratory' | 'passive';

  // Predictive risk (0–1)
  predictiveRiskScore: number;
  riskFactors: string[];

  // Session metadata
  sessionDurationMs: number;
}

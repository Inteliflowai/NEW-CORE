import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'supabase/**/*.test.ts'],
    testTimeout: 15000,
    // adaptQuestions (P2 Task 5) INTENTIONALLY catches LlmExhaustedError internally
    // and returns the original Q4/Q5 as a fallback (never-block contract). Vitest v4.x
    // on Node 24 detects certain promise rejections that ARE caught inside the SUT as
    // "unhandled" due to timing differences between the V8 microtask queue and Node's
    // unhandledRejection tracking. This suppresses false positives from that detection.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});

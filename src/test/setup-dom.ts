// Import this file in every component test that uses @vitest-environment jsdom.
// It registers jest-dom matchers (toBeInTheDocument etc.) and cleans up the DOM after each test.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

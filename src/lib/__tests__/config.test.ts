import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Config files', () => {
  describe('.env.example', () => {
    it('should exist', () => {
      const envPath = path.join(process.cwd(), '.env.example');
      expect(fs.existsSync(envPath)).toBe(true);
    });

    it('should contain all required keys', () => {
      const envPath = path.join(process.cwd(), '.env.example');
      const content = fs.readFileSync(envPath, 'utf-8');

      const requiredKeys = [
        // Supabase
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_DB_URL',
        'SUPABASE_ACCESS_TOKEN',
        // AI models
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_GRADING_MODEL',
        'OPENAI_API_KEY',
        'OPENAI_GEN_MODEL',
        'OPENAI_GRADING_FALLBACK',
        'OPENAI_VOICE_MODEL',
        // Licensing
        'LICENSE_KEY_SECRET',
        // Spark
        'CORE_SPARK_API_SECRET',
        // Media
        'FLUX_API_KEY',
        'RUNWAY_API_KEY',
        // Email
        'RESEND_API_KEY',
        // Monitoring
        'SENTRY_DSN',
        'SENTRY_AUTH_TOKEN',
        // Analytics
        'NEXT_PUBLIC_POSTHOG_KEY',
        'NEXT_PUBLIC_POSTHOG_HOST',
        'POSTHOG_PROJECT_API_KEY',
        'POSTHOG_PERSONAL_API_KEY',
        'POSTHOG_HOST',
        // Rate limit
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
        // Google
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI',
        // CRM
        'HIGHLEVEL_WEBHOOK_URL',
        'HIGHLEVEL_WEBHOOK_SECRET',
        // Cron
        'CRON_SECRET',
      ];

      for (const key of requiredKeys) {
        expect(content).toContain(key);
      }
    });

    it('should not contain any placeholder values', () => {
      const envPath = path.join(process.cwd(), '.env.example');
      const content = fs.readFileSync(envPath, 'utf-8');

      // Split by lines and filter out comments
      const lines = content
        .split('\n')
        .filter((line) => line.trim() && !line.trim().startsWith('#'));

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key) {
          // Value should be empty (nothing after the =)
          expect(value).toBe('');
        }
      }
    });
  });

  describe('vercel.json', () => {
    it('should exist', () => {
      const vercelPath = path.join(process.cwd(), 'vercel.json');
      expect(fs.existsSync(vercelPath)).toBe(true);
    });

    it('should be valid JSON', () => {
      const vercelPath = path.join(process.cwd(), 'vercel.json');
      const content = fs.readFileSync(vercelPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should have a crons array', () => {
      const vercelPath = path.join(process.cwd(), 'vercel.json');
      const content = fs.readFileSync(vercelPath, 'utf-8');
      const config = JSON.parse(content);
      expect(Array.isArray(config.crons)).toBe(true);
    });

    it('should contain all required cron paths', () => {
      const vercelPath = path.join(process.cwd(), 'vercel.json');
      const content = fs.readFileSync(vercelPath, 'utf-8');
      const config = JSON.parse(content);

      const requiredCrons = [
        '/api/cron/idempotency-sweep',
        '/api/cron/weekly-snapshot',
        '/api/cron/parent-narrative',
        '/api/cron/trial-expiry',
      ];

      const cronPaths = config.crons.map((cron: { path: string }) => cron.path);

      for (const cronPath of requiredCrons) {
        expect(cronPaths).toContain(cronPath);
      }
    });

    it('should have valid cron schedule format for all entries', () => {
      const vercelPath = path.join(process.cwd(), 'vercel.json');
      const content = fs.readFileSync(vercelPath, 'utf-8');
      const config = JSON.parse(content);

      // Cron format: minute hour day month dayOfWeek
      // Each cron should have 5 parts separated by spaces
      for (const cron of config.crons) {
        const parts = cron.schedule.split(' ');
        expect(parts.length).toBe(5);
        // Verify it's a string and contains space
        expect(typeof cron.schedule).toBe('string');
        expect(cron.schedule).toContain(' ');
      }
    });
  });
});

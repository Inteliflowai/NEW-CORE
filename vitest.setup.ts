process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
// Distinct from the grading model's default ('claude-sonnet-4-6') so model-routing
// tests discriminate CLAUDE_GEN_MODEL from CLAUDE_GRADING_MODEL, not just against the
// old hardcoded-model code. Grading is left on its default to keep value-assertions intact.
process.env.ANTHROPIC_GEN_MODEL ||= 'claude-gen-test';

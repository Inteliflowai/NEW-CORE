# SPARK Phase 1 — Ops handoff (go-live switch)

The shared secret already matches both repos (`CORE_SPARK_API_SECRET=<redacted>`).
No SPARK code deploy is needed — only env + two DB rows.

## 1. V2 Vercel env (project `new-core`)
- `SPARK_API_URL=https://spark.inteliflowai.com`
- `CORE_SPARK_API_SECRET=<redacted>` (must equal SPARK's value)
Promote the deploy after setting (preview→production).

## 2. V2 DB — demo school SPARK link
Seeded automatically by `npm run seed:demo` (Task 14). To verify / set manually, first get the demo school id:
```sql
-- on V2's Supabase
select id from schools where name = 'CORE Demo School' and demo_mode = true;
```
The seed writes a `platform_links` row (`product='spark'`, `enabled=true`, `core_base_url='https://newcore.inteliflowai.com'`).

## 3. SPARK DB — route the demo school's completions to V2 (ops runs this on SPARK's Supabase)
```sql
-- on SPARK's Supabase. Replace <V2_DEMO_SCHOOL_ID> with the id from step 2,
-- and <A_SPARK_SCHOOL_ID> with an existing SPARK school to link.
insert into core_spark_links (core_school_id, spark_school_id, core_base_url)
values ('<V2_DEMO_SCHOOL_ID>', '<A_SPARK_SCHOOL_ID>', 'https://newcore.inteliflowai.com')
on conflict (core_school_id) do update set core_base_url = excluded.core_base_url;
```
This row (a) lets SPARK accept the inbound create webhook (school must be linked) and
(b) routes the school's completion callbacks to V2 (`core_base_url`).

## 4. License
No `spark_experiences` table exists in V2; the SPARK gate is the enabled `platform_links` spark row (step 2). Nothing else to set.

## Phase-2 note (NOT this phase)
SPARK's `isValidReturnUrl` allow-list must add `newcore.inteliflowai.com` for the student launch back-button (a SPARK code change). Out of scope for Phase 1.

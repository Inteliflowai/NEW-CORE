# Support Tickets — Design Spec

> **Grounding:** inline (2026-06-26). V1 reference: `core/app/api/teacher/platform/tickets/`.
> **Status:** spec for sign-off. After sign-off: `writing-plans` → SDD.

## Goal

Any authenticated user (teacher, school-admin, student, parent) can submit a support ticket. Inteliflow platform-admins can triage, reply, add internal notes, and close tickets via an inbox page.

## Locked decisions (Marvin, 2026-06-26)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Full V1 parity**: category + priority + optional screenshot upload; all layouts; platform-admin inbox with internal notes + status management |
| D2 | Entry point | **Floating help button** (bottom-right corner of every authenticated layout) — not a sidebar nav entry |
| D3 | Screenshot storage | Private `support-uploads` Supabase Storage bucket; accessed via auth proxy route |
| D4 | Admin inbox | Platform-admin only (`platform_admin` role); no school-admin ticket visibility for now |

## Architecture

```
Any authenticated user
  → clicks floating ❓ help button (in every role layout)
  → HelpTicketModal: subject, description, category, priority, optional screenshot
  → POST /api/support/tickets
      → getUser (any role)
      → pull school_id from users table (null for parent if no school)
      → INSERT support_tickets
      → if screenshot: PUT /api/support/screenshot → support-uploads bucket

Platform admin
  → /platform/support inbox
  → GET /api/support/tickets (platform_admin only, all tickets)
  → detail panel: thread + POST /api/support/tickets/[id]/messages
  → status toggle: PATCH /api/support/tickets/[id]
```

## Data model (migration 0030 or 0031)

Note: If chapter eval migration uses 0030, this is 0031. The migrations are independent.

**`support_tickets`**
```sql
id uuid PK DEFAULT gen_random_uuid(),
submitted_by uuid NOT NULL REFERENCES users(id),
submitted_by_role text NOT NULL,   -- snapshot at submission time
school_id uuid REFERENCES schools(id),  -- null for parents without school affiliation
subject text NOT NULL,
description text NOT NULL,
category text DEFAULT 'general' CHECK (category IN ('general','bug','feature','account','data','other')),
priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
status text DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
screenshot_path text,   -- path in support-uploads bucket, null if no screenshot
assigned_to uuid REFERENCES users(id),  -- platform_admin who picked it up
resolved_at timestamptz,
created_at timestamptz DEFAULT now()
```
RLS: deny-by-default. Service_role INSERT (via admin client in the route). `platform_admin` SELECT all. Submitter SELECT own (`submitted_by = auth.uid()`).

**`support_ticket_messages`**
```sql
id uuid PK DEFAULT gen_random_uuid(),
ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
sender_id uuid NOT NULL REFERENCES users(id),
message text NOT NULL,
is_internal boolean DEFAULT false,   -- true = platform_admin internal note; hidden from submitter
created_at timestamptz DEFAULT now()
```
RLS: deny-by-default. Service_role INSERT. `platform_admin` SELECT all. Non-admin: SELECT where `ticket_id IN (SELECT id FROM support_tickets WHERE submitted_by = auth.uid()) AND is_internal = false`.

## File structure

**Migration:** `supabase/migrations/00XX_support_tickets.sql` (2 tables + RLS + private `support-uploads` bucket)

**Shared component (all layouts):**
- `src/components/core/HelpButton.tsx` — floating button (bottom-right, `fixed z-50`) + renders `HelpTicketModal`
- `src/components/core/HelpTicketModal.tsx` — subject + description + category (select) + priority (select) + optional screenshot (file input); calls `POST /api/support/tickets`

**Routes:**
- `POST /api/support/tickets` — any authenticated user; body: `{subject, description, category, priority, screenshotPath?}`; returns `{ticketId}`
- `GET /api/support/tickets` — `platform_admin` only (all tickets, paginated, filter by status); own-ticket view: `?mine=1` (any role)
- `PATCH /api/support/tickets/[id]` — platform_admin: update status + assigned_to
- `POST /api/support/tickets/[id]/messages` — ticket submitter OR platform_admin; body: `{message, is_internal?}`; `is_internal` only honored for platform_admin
- `GET /api/support/tickets/[id]/messages` — submitter (non-internal only) OR platform_admin (all)
- `POST /api/support/screenshot` — any authenticated user; multipart body: `{file}`; validates MIME (image/* only) + size (≤5 MB); uploads to `support-uploads/{userId}/{uuid}.{ext}`; returns `{path}`
- `GET /api/support/screenshot?path=…` — auth proxy (submitter of the ticket with that screenshot, or platform_admin); streams from private bucket

**Layout modifications (add `<HelpButton />` to each root layout):**
- `src/app/(teacher)/layout.tsx`
- `src/app/(school-admin)/layout.tsx`
- `src/app/(student)/layout.tsx`
- `src/app/(parent)/layout.tsx`

**Platform-admin inbox:**
- `src/app/(super-admin)/platform/support/page.tsx` — inbox page: list all tickets (status filter tabs: Open / In Progress / Resolved), click → detail panel
- `src/app/(super-admin)/platform/support/_components/TicketInbox.tsx` — list + filter
- `src/app/(super-admin)/platform/support/_components/TicketDetail.tsx` — thread view + reply + internal notes toggle + status buttons
- Add `/platform/support` to the super-admin nav (`src/app/(super-admin)/layout.tsx`)

## Category + priority options

**Categories:** General inquiry · Bug report · Feature request · Account issue · Data question · Other

**Priorities:** Low · Normal · High · Urgent

Priority displayed to platform-admin only (not shown in the submitter's view of their own ticket — avoid anxious users gaming urgency labels).

## Security

- Screenshot uploads: MIME check (image/* only, reject application/*) + 5 MB cap before Storage write. Private bucket — never directly accessible. Auth proxy validates ownership before streaming.
- `is_internal` messages: only insertable by `platform_admin`; RLS filters them out for non-admin SELECT.
- Cross-tenant IDOR: ticket reads scoped to `submitted_by = auth.uid()` for non-admin; `school_id` stamped at creation time for admin filtering.
- The screenshot proxy must validate `path` matches a `support-uploads/` prefix (prevent path traversal to other buckets).

## Test plan

- Submit ticket: any role → row inserted with correct school_id + submitted_by_role snapshot
- GET own tickets: returns only submitter's own rows
- Platform-admin GET all: returns all rows
- `is_internal`: non-admin cannot see internal messages (RLS); platform-admin can
- Screenshot upload: image/* accepted; non-image rejected 400; >5 MB rejected 413
- Screenshot proxy: submitter gets their own screenshot; different user gets 403; platform-admin always gets it
- Layouts: `HelpButton` renders in teacher + school-admin + student + parent layouts

## Gates

tsc 0 · vitest green · build 0 (a11y + tokens). Migration (next available number). Strings → `STRINGS-FOR-BARB.md §Support Tickets`.

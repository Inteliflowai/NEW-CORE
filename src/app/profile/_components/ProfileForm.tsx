'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface ProfileFormProps {
  initialName: string;
  email: string;
  avatarUrl: string | null;
}

export function ProfileForm({ initialName, email, avatarUrl: initialAvatarUrl }: ProfileFormProps) {
  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [avatarStatus, setAvatarStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Name state
  const [name, setName] = useState(initialName);
  const [nameStatus, setNameStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // --- Avatar upload ---
  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarStatus(null);
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) {
        setAvatarStatus({ kind: 'error', message: body.error ?? 'Upload failed — try again.' });
      } else {
        setAvatarUrl(body.avatar_url);
        setAvatarStatus({ kind: 'success', message: 'Photo updated.' });
      }
    } catch {
      setAvatarStatus({ kind: 'error', message: 'Upload failed — try again.' });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // --- Name save ---
  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameStatus(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameStatus({ kind: 'error', message: 'Name is required.' });
      return;
    }
    setNameSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNameStatus({ kind: 'error', message: body.error ?? 'Could not save — try again.' });
      } else {
        setName(body.full_name ?? trimmed);
        setNameStatus({ kind: 'success', message: 'Name saved.' });
      }
    } catch {
      setNameStatus({ kind: 'error', message: 'Could not save — try again.' });
    } finally {
      setNameSaving(false);
    }
  }

  // --- Password change ---
  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordStatus(null);
    if (newPassword.length < 8) {
      setPasswordStatus({ kind: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ kind: 'error', message: 'Passwords do not match.' });
      return;
    }
    setPasswordSaving(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordStatus({ kind: 'error', message: error.message });
      } else {
        setNewPassword('');
        setConfirmPassword('');
        setPasswordStatus({ kind: 'success', message: 'Password updated.' });
      }
    } catch {
      setPasswordStatus({ kind: 'error', message: 'Could not update password — try again.' });
    } finally {
      setPasswordSaving(false);
    }
  }

  // Derive initials for the placeholder
  const initials = name.trim()
    ? name.trim().split(/\s+/).map((w) => w[0].toUpperCase()).slice(0, 2).join('')
    : '?';

  return (
    <div className="min-h-screen bg-bg p-6">
      <div className="mx-auto max-w-lg">
        <Link href="/today" className="text-sm text-brand hover:underline">
          ← Back
        </Link>

        <h1 className="mt-4 mb-6 font-display text-2xl font-bold text-fg">Profile settings</h1>

        {/* ── Avatar ── */}
        <section className="mb-8 rounded-lg bg-surface p-6 shadow-sticker">
          <h2 className="mb-4 text-sm font-semibold text-fg">Profile photo</h2>

          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Your profile photo"
                className="size-16 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-16 items-center justify-center rounded-full bg-brand text-xl font-bold text-fg-on-brand"
              >
                {initials}
              </span>
            )}

            <label className="flex flex-col gap-1 text-sm text-fg">
              <span className="sr-only">Upload photo</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Upload photo"
                disabled={avatarUploading}
                onChange={onFileChange}
                className="text-sm text-fg-muted file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1 file:text-sm file:font-medium file:text-fg-on-brand"
              />
              <span className="text-xs text-fg-muted">PNG, JPEG, or WebP · max 4 MB</span>
            </label>
          </div>

          {avatarStatus && (
            <p
              role={avatarStatus.kind === 'error' ? 'alert' : 'status'}
              className={`mt-3 rounded px-3 py-2 text-sm ${
                avatarStatus.kind === 'error'
                  ? 'bg-risk-surface text-risk-fg'
                  : 'bg-ok-surface text-ok-fg'
              }`}
            >
              {avatarStatus.message}
            </p>
          )}
        </section>

        {/* ── Display name ── */}
        <section className="mb-8 rounded-lg bg-surface p-6 shadow-sticker">
          <h2 className="mb-4 text-sm font-semibold text-fg">Display name</h2>

          <form onSubmit={onSaveName} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-fg">
              Display name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg"
              />
            </label>

            <button
              type="submit"
              disabled={nameSaving}
              className="self-start rounded bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand disabled:opacity-50"
            >
              {nameSaving ? 'Saving…' : 'Save name'}
            </button>

            {nameStatus && (
              <p
                role={nameStatus.kind === 'error' ? 'alert' : 'status'}
                className={`rounded px-3 py-2 text-sm ${
                  nameStatus.kind === 'error'
                    ? 'bg-risk-surface text-risk-fg'
                    : 'bg-ok-surface text-ok-fg'
                }`}
              >
                {nameStatus.message}
              </p>
            )}
          </form>
        </section>

        {/* ── Email (read-only) ── */}
        <section className="mb-8 rounded-lg bg-surface p-6 shadow-sticker">
          <h2 className="mb-2 text-sm font-semibold text-fg">Email</h2>
          <p className="text-sm text-fg-muted">
            {email}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Your email is managed by your school and cannot be changed here.
          </p>
        </section>

        {/* ── Password ── */}
        <section className="mb-8 rounded-lg bg-surface p-6 shadow-sticker">
          <h2 className="mb-4 text-sm font-semibold text-fg">Change password</h2>

          <form onSubmit={onChangePassword} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-fg">
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-fg">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg"
              />
            </label>

            <button
              type="submit"
              disabled={passwordSaving}
              className="self-start rounded bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand disabled:opacity-50"
            >
              {passwordSaving ? 'Saving…' : 'Change password'}
            </button>

            {passwordStatus && (
              <p
                role={passwordStatus.kind === 'error' ? 'alert' : 'status'}
                className={`rounded px-3 py-2 text-sm ${
                  passwordStatus.kind === 'error'
                    ? 'bg-risk-surface text-risk-fg'
                    : 'bg-ok-surface text-ok-fg'
                }`}
              >
                {passwordStatus.message}
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}

export default ProfileForm;

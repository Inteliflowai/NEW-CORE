// src/app/(teacher)/settings/google/page.tsx
import GoogleConnectCard from './_components/GoogleConnectCard';

export default async function GoogleSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <GoogleConnectCard initialError={sp.error ?? null} justConnected={sp.connected === '1'} />
    </div>
  );
}

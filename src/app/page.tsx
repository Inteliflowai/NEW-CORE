import Image from "next/image";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-white px-6 text-center">
      <div className="relative h-32 w-80 sm:h-40 sm:w-[28rem]">
        <Image
          src="/images/new-core.jpg"
          alt="CORE"
          fill
          priority
          sizes="(max-width: 640px) 20rem, 28rem"
          className="object-contain"
        />
      </div>
      <p className="max-w-md text-base leading-7 text-zinc-500">
        Learning Intelligence. Built on pedagogy. Powered by AI.
      </p>
      <span className="rounded-full bg-violet-100 px-4 py-1.5 text-xs font-medium tracking-wide text-violet-700">
        v2 · coming soon
      </span>
    </main>
  );
}

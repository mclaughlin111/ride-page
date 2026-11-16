"use client";

import { LoadError } from "@/components/States";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4">
      <LoadError message="Something went wrong showing this page." />
      <button type="button" className="btn mt-4" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

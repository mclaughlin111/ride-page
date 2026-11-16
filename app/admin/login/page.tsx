import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getAuthConfig } from "@/lib/auth";
import { hasAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin login · Ride Board",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  if (await hasAdminSession()) redirect("/admin");
  const params = await searchParams;
  const configured = getAuthConfig() !== null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-4">
      <p className="text-sm font-bold uppercase tracking-[0.12em]">Ride Board</p>
      {configured ? (
        <LoginForm expired={params.expired === "1"} />
      ) : (
        <div className="card p-5" role="alert">
          <p className="label text-danger">Admin not configured</p>
          <p className="mt-2 text-sm">
            Set <code>ADMIN_PASSWORD</code> and <code>SESSION_SECRET</code> (16+
            characters) in the server environment, then restart.
          </p>
        </div>
      )}
      <Link href="/" className="btn">
        Back to rides
      </Link>
    </main>
  );
}

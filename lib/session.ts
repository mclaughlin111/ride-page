import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isAuthenticatedToken } from "./auth";

/** For server components: true when the request carries a valid admin session. */
export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  return isAuthenticatedToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireAdminPage(): Promise<void> {
  if (!(await hasAdminSession())) redirect("/admin/login");
}

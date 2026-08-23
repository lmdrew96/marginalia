import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/library");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Marginalia</h1>
      <p className="max-w-md text-lg text-secondary">
        Upload a reading, highlight what matters, pick up where you left off.
      </p>
      <Link
        href="/sign-in"
        className="rounded-full bg-foreground px-6 py-3 font-medium text-background transition-opacity hover:opacity-90"
      >
        Sign in
      </Link>
    </div>
  );
}

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PenNibIcon } from "@/components/icons";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/library");

  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <PenNibIcon className="h-10 w-10 text-accent" />
      <div>
        <p className="eyebrow">A reading desk</p>
        <h1 className="font-display text-6xl font-semibold tracking-tight">
          Marginalia
        </h1>
      </div>
      <p className="max-w-md font-display text-xl italic text-secondary">
        Upload a reading, highlight what matters, write in the margins, and
        pick up where you left off.
      </p>
      <Link
        href="/sign-in"
        className="rounded-full bg-accent-fill px-6 py-3 font-medium text-on-accent transition-opacity hover:opacity-90"
      >
        Sign in
      </Link>
    </div>
  );
}

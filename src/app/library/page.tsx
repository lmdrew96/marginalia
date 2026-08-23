import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { UploadDocument } from "@/components/UploadDocument";

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.uploadedAt));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your library</h1>
        <UploadDocument />
      </div>

      {docs.length === 0 ? (
        <p className="text-secondary">
          Nothing here yet — upload a PDF to get started.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.id}>
              <Link
                href={`/read/${doc.id}`}
                className="group flex items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:bg-surface"
              >
                <span className="font-medium group-hover:text-on-surface">
                  {doc.title}
                </span>
                <span className="text-sm text-secondary group-hover:text-on-surface-secondary">
                  {new Date(doc.uploadedAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

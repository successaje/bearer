import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";

/**
 * Marks every page under a vault as per-request: the link preview (opengraph-image) applies to
 * the vault page and the pages below it, and it depends on the vault's live state.
 */
async function PerRequest() {
  await connection();
  return null;
}

export default function VaultLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PerRequest />
      </Suspense>
      {children}
    </>
  );
}

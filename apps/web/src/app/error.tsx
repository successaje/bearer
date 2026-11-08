"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/layout/page-states";
import { Button, buttonVariants } from "@/components/ui/button";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[640px] px-5 pt-16 md:pt-24">
      <EmptyState
        seal="cracked"
        title="Something went wrong"
        action={
          <>
            <Button variant="primary" size="lg" onClick={reset}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
            <Link href="/" className={buttonVariants({ size: "lg" })}>
              Go home
            </Link>
          </>
        }
      >
        <p>{error.message || "An unexpected error stopped this page from loading."}</p>
        {error.digest ? <p className="mt-2 font-mono text-[12px] text-fg-3">Reference {error.digest}</p> : null}
      </EmptyState>
    </div>
  );
}

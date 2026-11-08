import Link from "next/link";
import { EmptyState } from "@/components/layout/page-states";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] px-5 pt-16 md:pt-24">
      <EmptyState
        seal="opened"
        title="This page isn't here"
        action={
          <>
            <Link href="/" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Go home
            </Link>
            <Link href="/verify" className={buttonVariants({ size: "lg" })}>
              Verify a vault
            </Link>
          </>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </div>
  );
}

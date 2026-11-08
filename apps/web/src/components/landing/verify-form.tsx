"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/primitives";
import { parseCardRef } from "@/lib/validation";
import { cn } from "@/lib/utils";

export function VerifyForm({
  label = "Check any card",
  hint = "The report link works for anyone. Paste it into an OTC chat.",
  size = "md",
  autoFocus,
  className,
}: {
  label?: string;
  hint?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const ref = parseCardRef(value);
    if (!ref) {
      setError("Enter a card number like 42, or paste a Bearer card link.");
      return;
    }
    setError(null);
    router.push(`/c/${ref}`);
  }

  return (
    <form onSubmit={submit} className={className} noValidate>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2.5 flex flex-wrap gap-2.5">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Card number or link"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          className={cn("flex-[1_1_240px] bg-bg", size === "lg" && "h-14 text-base")}
        />
        <Button type="submit" variant="inverse" size={size === "lg" ? "lg" : "md"} className={size === "lg" ? "h-14" : "h-12"}>
          Check seal
          <ArrowRight className="size-4" />
        </Button>
      </div>
      <FieldMessage id={`${id}-hint`} tone={error ? "error" : "muted"} role={error ? "alert" : undefined}>
        {error ?? hint}
      </FieldMessage>
    </form>
  );
}

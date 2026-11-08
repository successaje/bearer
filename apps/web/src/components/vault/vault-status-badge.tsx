import { CircleDashed, Loader2, PackageOpen, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { VaultStatus } from "@/lib/vault/report";

const STATUS: Record<VaultStatus, { tone: BadgeTone; icon: ReactNode; label: string }> = {
  sealed: { tone: "ok", icon: <ShieldCheck aria-hidden />, label: "Sealed" },
  opened: { tone: "gold", icon: <PackageOpen aria-hidden />, label: "Opened" },
  withdrawing: { tone: "info", icon: <Loader2 aria-hidden className="animate-spin" />, label: "Withdrawing" },
  empty: { tone: "neutral", icon: <CircleDashed aria-hidden />, label: "Empty" },
};

export function VaultStatusBadge({ status, className }: { status: VaultStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Badge>
  );
}

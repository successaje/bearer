"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "@/components/theme/theme-provider";
import { WalletProvider } from "@/components/wallet/wallet-provider";

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: "!rounded-[12px] !border-line-strong !bg-surface-2 !text-fg !font-sans",
          description: "!text-fg-2",
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          {children}
          <ThemedToaster />
        </WalletProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

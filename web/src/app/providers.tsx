"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { UIStoreSync } from "@/components/UIStoreSync";
import { SyncNotification } from "@/components/SyncNotification";
import { CollabSocketProvider } from "@/hooks/useCollabSocket";
import { CoworkAccessGuard } from "@/components/CoworkAccessGuard";
import { valeApi } from "@/lib/api";

function ValeStartupSync() {
  useEffect(() => {
    valeApi.getSyncStatus()
      .then(s => { if (!s.last_synced) valeApi.syncRules().catch(() => {}); })
      .catch(() => {});
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <UIStoreSync />
          <SyncNotification />
          <ValeStartupSync />
          <CollabSocketProvider />
          <CoworkAccessGuard>{children}</CoworkAccessGuard>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

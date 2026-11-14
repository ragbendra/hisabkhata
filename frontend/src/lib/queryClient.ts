import { QueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Always run the query function: it falls back to the IndexedDB copy when the network is down.
      networkMode: "always",
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (count, err) => {
        if (err instanceof NetworkError) return false;
        if (err instanceof ApiError && err.status < 500) return false;
        return count < 1;
      },
    },
    mutations: { networkMode: "always" },
  },
});

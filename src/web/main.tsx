import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { initInstallPrompt } from "./lib/install";

initInstallPrompt();

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // A 401 on any request means the session ended (expired, signed out elsewhere, account deactivated):
    // drop the cached identity so the route guards send the user to the sign-in page.
    onError: (error, query) => {
      if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== "me") queryClient.setQueryData(["me"], null);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 4000 }} />
    </QueryClientProvider>
  </StrictMode>,
);

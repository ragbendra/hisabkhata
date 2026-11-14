import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "@fontsource/noto-serif-devanagari/500.css";
import "@fontsource/noto-serif-devanagari/600.css";
import "./index.css";
import "./lib/i18n";
import { queryClient } from "./lib/queryClient";
import { startSync } from "./lib/sync";

registerSW({ immediate: true });
startSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

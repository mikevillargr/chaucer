import { QueryClientProvider } from "@tanstack/react-query";
import "material-symbols/rounded.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initPlatform } from "./lib/platform";
import { queryClient } from "./lib/queries";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/themes.css";

initPlatform();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

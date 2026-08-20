import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Fallback for builds/dev mode that don't set VITE_APP_TITLE — index.html's
// %VITE_APP_TITLE% substitution (Vite's build-time HTML replacement) covers
// every packaged build (see install.sh / build.ps1 / deb build.sh, all of
// which set it), but `npm run dev`/a bare `vite build` with no matching
// .env file would otherwise leave the tab title blank.
if (!document.title || document.title === "%VITE_APP_TITLE%") {
  document.title = import.meta.env.VITE_REMOTE === "true" ? "bboxAI-Remote" : "bboxAI-Desktop";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

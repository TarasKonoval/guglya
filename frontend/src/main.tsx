import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "aws-amplify/auth/enable-oauth-listener"; // completes the Google redirect sign-in
import { configureAuth } from "./lib/auth";
import "./styles.css";

configureAuth();

// Heatmaps and session replays (Microsoft Clarity), only when a project id is set at build time
const CLARITY_ID = import.meta.env.VITE_CLARITY_ID;
if (CLARITY_ID && /^[a-z0-9]{6,20}$/i.test(CLARITY_ID)) {
  const w = window as unknown as { clarity?: { q?: unknown[] } & ((...a: unknown[]) => void) };
  w.clarity = w.clarity || Object.assign((...a: unknown[]) => { (w.clarity!.q = w.clarity!.q || []).push(a); }, {});
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.clarity.ms/tag/${CLARITY_ID}`;
  document.head.appendChild(s);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

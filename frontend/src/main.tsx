import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "aws-amplify/auth/enable-oauth-listener"; // completes the Google redirect sign-in
import { configureAuth } from "./lib/auth";
import "./styles.css";

configureAuth();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Configuration front. En prod (servi sous app.swiss-piscine.ch), l'API est
// derrière le même domaine via nginx ("/api"). En dev local, on pointe sur uvicorn.
const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);

export const API_BASE = isLocalDev
  ? "http://localhost:8000"
  : "/api";

export const APP_NAME = "Swiss Piscine — Équipe";

// Casement — entry point. Bootstraps the app shell into #app.
import { mountApp } from "./ui/app";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) {
  mountApp(root);
}

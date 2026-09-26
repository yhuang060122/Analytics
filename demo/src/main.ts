import "./style.css";
import { analytics } from "./analytics";
import { mountInspectorToolbar } from "./inspector-toolbar";

const counterBtn =
  document.querySelector<HTMLButtonElement>("#counterBtn")!;

let counter = 0;

counterBtn.addEventListener("click", () => {
  counter += 1;

  counterBtn.textContent = `Clicks: ${counter}`;

  // Auto click tracking fires too: this adds the payload.
  analytics.track("Counter Clicked", { count: counter });
});

document
  .querySelector("#checkoutBtn")!
  .addEventListener("click", () => {
    analytics.track("Checkout", {
      amount: 199.9,
      currency: "USD",
      items: 2,
    });
  });

document
  .querySelector("#burstBtn")!
  .addEventListener("click", () => {
    for (let index = 1; index <= 10; index += 1) {
      analytics.track("Burst Event", { index });
    }
  });

mountInspectorToolbar();

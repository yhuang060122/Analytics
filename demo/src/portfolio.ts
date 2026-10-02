import "./style.css";
import { analytics } from "./analytics";

interface Holding {
  symbol: string;
  shares: number;
  value: number;
}

const holdingsEl =
  document.querySelector<HTMLUListElement>("#holdings")!;

const refreshBtn =
  document.querySelector<HTMLButtonElement>("#refreshBtn")!;

function renderHoldings(holdings: readonly Holding[]): void {
  holdingsEl.innerHTML = holdings
    .map(
      (holding) => `
        <li>
          <b>${holding.symbol}</b>
          <span>${holding.shares} shares</span>
          <span class="num">¥${holding.value.toFixed(2)}</span>
        </li>
      `,
    )
    .join("");
}

async function refresh(): Promise<void> {
  refreshBtn.disabled = true;

  analytics.track("Refresh Portfolio");

  try {
    const response = await fetch("/api/portfolio");

    const holdings: readonly Holding[] =
      await response.json();

    renderHoldings(holdings);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", () => {
  void refresh();
});

/**
 * Auto click tracking already reports the click:
 * this adds the business payload on top.
 */
document
  .querySelector("#buyBtn")!
  .addEventListener("click", () => {
    analytics.track("Order Placed", {
      symbol: "NVDA",
      side: "buy",
      quantity: 1,
    });
  });

void refresh();


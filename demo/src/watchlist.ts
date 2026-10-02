import "./style.css";
import { analytics } from "./analytics";

const newsEl =
  document.querySelector<HTMLUListElement>("#news")!;

const loadNewsBtn =
  document.querySelector<HTMLButtonElement>("#loadNews")!;

async function loadNews(): Promise<void> {
  loadNewsBtn.disabled = true;

  analytics.track("Load News");

  try {
    const response = await fetch("/api/news");

    const headlines: readonly string[] =
      await response.json();

    newsEl.innerHTML = headlines
      .map((headline) => `<li>${headline}</li>`)
      .join("");
  } finally {
    loadNewsBtn.disabled = false;
  }
}

loadNewsBtn.addEventListener("click", () => {
  void loadNews();
});

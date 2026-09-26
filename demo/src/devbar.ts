import { analytics } from "./analytics";

/**
 * Small toolbar shared by every page:
 * queue state, manual flush, outage switch, destroy().
 */
export function mountDevBar(host: HTMLElement): void {
  host.className = "devbar";

  host.innerHTML = `
    <span class="devbar-title">调试工具条</span>

    <span class="devbar-stat">
      队列 <b id="devPending">0</b>
      ·
      已送达 <b id="devSent">0</b>
    </span>

    <button class="btn tiny" id="devFlush">
      立即 flush
    </button>

    <button class="btn tiny ghost" id="devOutage">
      后端故障：关
    </button>

    <button class="btn tiny ghost" id="devDestroy">
      destroy()
    </button>
  `;

  const pendingEl = host.querySelector("#devPending")!;

  const sentEl = host.querySelector("#devSent")!;

  const outageBtn =
    host.querySelector<HTMLButtonElement>("#devOutage")!;

  let sent = 0;

  analytics.debug.bus.subscribe((event) => {
    if (event.stage !== "sent") return;

    sent += 1;
    sentEl.textContent = String(sent);
  });

  setInterval(() => {
    pendingEl.textContent = String(analytics.pending);
  }, 400);

  host
    .querySelector("#devFlush")!
    .addEventListener("click", () => {
      void analytics.flush();
    });

  let failing = false;

  outageBtn.addEventListener("click", () => {
    failing = !failing;

    void fetch(
      `/api/analytics/outage?state=${failing ? "on" : "off"}`,
    );

    outageBtn.textContent = `后端故障：${
      failing ? "开" : "关"
    }`;

    outageBtn.classList.toggle("danger", failing);
  });

  host
    .querySelector("#devDestroy")!
    .addEventListener("click", () => {
      analytics.destroy();

      host.classList.add("devbar-off");

      outageBtn.disabled = true;

      console.log(
        "[demo] destroy() 已调用：之后的点击不再上报",
      );
    });
}

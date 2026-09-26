import { analytics } from "./analytics";

/**
 * Mounts demo controls into the Analytics
 * Inspector's toolbar slot:
 * queue state, manual flush, outage switch, destroy().
 */
export function mountInspectorToolbar(): void {
  const slot = analytics.debug.getInspector()?.getToolbar();

  if (!slot) {
    console.warn(
      "[demo] Inspector is not enabled, no toolbar slot",
    );
    return;
  }

  const btnStyle = `
    all:unset;
    cursor:pointer;
    padding:3px 8px;
    border-radius:6px;
    background:#374151;
    color:#F9FAFB;
    font-size:11px;
    white-space:nowrap;
  `;

  slot.innerHTML = `
    <span style="color:#9CA3AF;font-size:11px">
      Queue <b id="devPending" style="color:#F9FAFB">0</b>
      ·
      Sent <b id="devSent" style="color:#F9FAFB">0</b>
    </span>

    <button id="devFlush">Flush now</button>

    <button id="devOutage"><span id="devOutageLabel">Outage: OFF</span></button>

    <button id="devDestroy">destroy()</button>
  `;

  const styled = slot.querySelectorAll("button");

  styled.forEach((b) => (b.style.cssText = btnStyle));

  const pendingEl = slot.querySelector("#devPending")!;
  const sentEl = slot.querySelector("#devSent")!;
  const outageBtn = slot.querySelector<HTMLButtonElement>("#devOutage")!;
  const outageLabel = slot.querySelector<HTMLSpanElement>("#devOutageLabel")!;
  const destroyBtn = slot.querySelector<HTMLButtonElement>("#devDestroy")!;

  let sent = 0;

  analytics.debug.bus.subscribe((event) => {
    if (event.stage !== "sent") return;

    sent += 1;
    sentEl.textContent = String(sent);
  });

  const pendingTimer = setInterval(() => {
    pendingEl.textContent = String(analytics.pending);
  }, 400);

  slot.querySelector("#devFlush")!.addEventListener("click", () => {
    void analytics.flush();
  });

  let failing = false;

  outageBtn.addEventListener("click", () => {
    failing = !failing;

    void fetch(`/api/analytics/outage?state=${failing ? "on" : "off"}`);

    outageLabel.textContent = `Outage: ${failing ? "ON" : "OFF"}`;
    outageBtn.style.background = failing ? "#7F1D1D" : "#374151";
  });

  destroyBtn.addEventListener("click", () => {
    analytics.destroy();

    clearInterval(pendingTimer);

    outageBtn.disabled = true;
    destroyBtn.disabled = true;
    destroyBtn.style.opacity = "0.5";

    console.log("[demo] destroy() called: no more events tracked");
  });

  // slot is display:none until someone asks for it
  analytics.debug.getInspector()!.showToolbar();
}

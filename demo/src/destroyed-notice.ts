const NOTICE_ID = "analytics-destroyed-notice";

/**
 * Standalone "destroyed" banner.
 *
 * The Inspector panel is owned by a debug plugin now, so
 * `destroy()` removes it — and the demo toolbar lives inside
 * that panel, so the controls vanish with it. This banner is
 * deliberately independent: it is appended to <body> and does
 * not go through the debug layer, so it survives the teardown
 * and can explain why the controls disappeared.
 *
 * Destroyed is terminal, so the banner stays until reload
 * instead of timing out.
 */
export function showDestroyedNotice(): void {

  if (document.getElementById(NOTICE_ID)) return;

  const notice = document.createElement("div");
  notice.id = NOTICE_ID;

  notice.style.cssText = `
    position:fixed;
    right:16px;
    bottom:16px;
    width:340px;
    display:flex;
    flex-direction:column;
    gap:8px;
    padding:12px;
    background:#111827;
    color:#F9FAFB;
    font:12px Inter,sans-serif;
    border-radius:12px;
    border-left:3px solid #EF4444;
    box-shadow:0 8px 30px rgba(0,0,0,.35);
    z-index:999999;
  `;

  const title = document.createElement("div");
  title.textContent = "Analytics destroyed";
  title.style.cssText = "font-weight:700;font-size:13px;";

  const body = document.createElement("div");
  body.textContent =
    "Probes stopped, listeners and timers released. " +
    "The Inspector went with them — no further events " +
    "will be tracked on this page.";
  body.style.cssText = "color:#9CA3AF;line-height:1.5;";

  const reload = document.createElement("button");
  reload.textContent = "Reload page";
  reload.style.cssText = `
    all:unset;
    cursor:pointer;
    align-self:flex-start;
    padding:4px 10px;
    border-radius:6px;
    background:#374151;
    color:#F9FAFB;
    font-size:11px;
    font-weight:700;
  `;
  reload.addEventListener("click", () => location.reload());

  notice.appendChild(title);
  notice.appendChild(body);
  notice.appendChild(reload);

  document.body.appendChild(notice);

}

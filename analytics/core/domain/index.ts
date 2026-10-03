export * from "./event";
export * from "./context";
export * from "./page-context";

// Two modules are deliberately absent, and for the same reason:
// nothing outside the SDK reads them, so exporting them would
// only make the internals look like API.
//
//   session-id.ts  reads the correlation id the *host* wrote into
//                  sessionStorage. It used to mint one here and
//                  keep it for the visit, which is the same
//                  mistake as the id below in a different place:
//                  the collector issues its own correlation ids,
//                  and a second client-minted one does not join
//                  anything — it just looks like it might.
//   id.ts         was `createId`, which minted a v4 UUID per event.
//                  It went with `AnalyticsEvent.id` — nothing in
//                  this SDK de-duplicates or correlates, so a
//                  collector was being handed an id it was going
//                  to assign a primary key to anyway.
//
// Both were deleted for one reason, and it is worth keeping the
// reason rather than the code: an identifier is only worth
// minting if something reads it. When nothing does, minting is
// not neutrality — a second identifier with the same meaning and
// a different shape is something downstream has to be taught not
// to trust.

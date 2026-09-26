// Provider

import { InjectionToken } from "@angular/core";
import { Analytics } from "./analytics";

export const ANALYTICS =
  new InjectionToken<Analytics>("Analytics");

// app.config.ts

providers: [

  {
    provide: ANALYTICS,
    useValue: new Analytics({
      endpoint: "/api/analytics/events",
    }),
  },

]


// Component

constructor(
  @Inject(ANALYTICS)
  private analytics: Analytics
) {}

save() {

  this.analytics.track(
    "SaveClicked",
    {
      ticker: "MSFT",
    }
  );

}

// 自动 Page View Angular Router：

import { filter } from "rxjs/operators";
import { NavigationEnd, Router } from "@angular/router";

router.events
  .pipe(
    filter(e => e instanceof NavigationEnd)
  )
  .subscribe(() => {

    analytics.page();

  });

// Angular Router（推荐）SPA 不会触发 popstate，所以最好在 Angular 里通知。

router.events
  .pipe(
    filter(e => e instanceof NavigationEnd)
  )
  .subscribe((e: NavigationEnd) => {

    pageTracker.notifyRouteChange(
      e.urlAfterRedirects
    );

  });
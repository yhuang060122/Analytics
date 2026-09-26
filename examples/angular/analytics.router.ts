import { inject, Injectable } from "@angular/core";
import {
  NavigationEnd,
  Router,
} from "@angular/router";

import { filter } from "rxjs/operators";

import { ANALYTICS } from "./analytics.provider";

@Injectable({ providedIn: "root" })
export class AnalyticsRouterTracker {

  private readonly router = inject(Router);

  private readonly analytics = inject(ANALYTICS);

  start(): void {

    this.analytics.page();

    this.router.events
      .pipe(
        filter(
          e => e instanceof NavigationEnd
        )
      )
      .subscribe((e: NavigationEnd) => {

        this.analytics.page(
          e.urlAfterRedirects
        );

      });

  }

}

@Injectable({ providedIn: "root" })
export class AnalyticsRouter {

  private readonly tracker = inject(PageTracker);

  private readonly router = inject(Router);

  start(): void {

    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd)
      )
      .subscribe((e: NavigationEnd) => {

        this.tracker.navigate(
          e.urlAfterRedirects
        );

      });

  }

}
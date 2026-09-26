import { inject, Injectable } from "@angular/core";
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpResponse,
  HttpErrorResponse,
} from "@angular/common/http";

import { Observable, tap } from "rxjs";

import { ANALYTICS } from "../../examples/angular/analytics.provider";

@Injectable()
export class AnalyticsHttpInterceptor implements HttpInterceptor {

  private readonly analytics = inject(ANALYTICS);

  intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {

    const started = performance.now();

    return next.handle(request).pipe(

      tap({

        next: event => {

          if (!(event instanceof HttpResponse)) {
            return;
          }

          this.analytics.track(
            "API Request",
            {
              method: request.method,
              url: request.urlWithParams,
              status: event.status,
              durationMs: Math.round(
                performance.now() - started
              ),
              pagePath: window.location.pathname,
            }
          );

        },

        error: (error: HttpErrorResponse) => {

          this.analytics.track(
            "API Error",
            {
              method: request.method,
              url: request.urlWithParams,
              status: error.status,
              durationMs: Math.round(
                performance.now() - started
              ),
              pagePath: window.location.pathname,
            }
          );

        },

      })

    );

  }

}
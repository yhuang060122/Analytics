// // AppConfig

// import {
//   provideHttpClient,
//   withInterceptors,
// } from "@angular/common/http";

// import { provideAnalytics } from "./analytics";

// export const appConfig: ApplicationConfig = {

//   providers: [

//     provideAnalytics({

//       endpoint: "/api/analytics/events",

//       batchSize: 20,

//       flushInterval: 1000,

//     }),

//     provideHttpClient(
//       withInterceptors([
//         AnalyticsHttpInterceptor,
//       ])
//     ),

//   ],

// };

// // AppComponent 启动 Router Tracker

// @Component({...})
// export class AppComponent {

//   private readonly tracker = inject(
//     AnalyticsRouterTracker
//   );

//   ngOnInit(): void {

//     this.tracker.start();

//   }

// }
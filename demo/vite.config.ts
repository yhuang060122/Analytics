import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only stand-in for the real collector.
 *
 * Accepts the SDK payload so the demo can be verified
 * end to end, and can simulate an outage to exercise
 * the retry logic in EventQueue.
 */
function analyticsMockApi(): Plugin {
  let failing = false;

  return {
    name: "analytics-mock-api",

    configureServer(server) {
      const received: any[] = [];

      server.middlewares.use(
        "/api/analytics/events",
        (req: any, res: any, next: any) => {
          if (req.method !== "POST") {
            next();
            return;
          }

          let body = "";

          req.on("data", (chunk: any) => (body += chunk));

          req.on("end", () => {
            res.setHeader("Content-Type", "application/json");

            if (failing) {
              res.statusCode = 500;
              res.end(
                JSON.stringify({ error: "simulated outage" }),
              );

              server.config.logger.info(
                "[mock-api] 500 ← simulated outage, dropped " +
                  (JSON.parse(body || "{}").events ?? []).length +
                  " events",
              );

              return;
            }

            const batch = JSON.parse(body || "{}").events ?? [];

            received.push(...batch);

            server.config.logger.info(
              `\n[mock-api] received ${batch.length} events (total ${received.length})`,
            );

            batch.forEach((context: any) =>
              server.config.logger.info(
                `  · ${String(context.event.type).padEnd(5)} ` +
                  `${context.event.name}  [session ${context.sessionId.slice(0, 8)}]`,
              ),
            );

            res.statusCode = 202;
            res.end(JSON.stringify({ accepted: batch.length }));
          });
        },
      );

      server.middlewares.use(
        "/api/analytics/outage",
        (req: any, res: any) => {
          failing = String(req.url ?? "").includes("state=on");

          server.config.logger.info(
            `[mock-api] outage ${failing ? "ON" : "OFF"}`,
          );

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ failing }));
        },
      );

      server.middlewares.use(
        "/api/portfolio",
        (_req: any, res: any) => {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify([
              { symbol: "NVDA", shares: 12, value: 2148.6 },
              { symbol: "AAPL", shares: 30, value: 6210.0 },
              { symbol: "MSFT", shares: 8, value: 3402.4 },
            ]),
          );
        },
      );

      server.middlewares.use("/api/news", (_req: any, res: any) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify([
            "NVDA beats earnings estimates, up 6% after hours",
            "AAPL announces a new buyback program",
            "MSFT cloud growth picks up again",
          ]),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [analyticsMockApi()],

  server: {
    port: 5173,
  },

  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(
          new URL("./index.html", import.meta.url),
        ),
        portfolio: fileURLToPath(
          new URL("./portfolio.html", import.meta.url),
        ),
        watchlist: fileURLToPath(
          new URL("./watchlist.html", import.meta.url),
        ),
      },
    },
  },
});

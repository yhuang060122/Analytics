export const analytics = new Analytics({
  endpoint: "/api/analytics/events",

  debug: {
    enabled: import.meta.env.DEV,
    inspector: true,
    console: false,
  },
});

if (import.meta.env.DEV) {
  (window as any).analytics = analytics;
}

// 开启 Console 输出
analytics.debug.console(true)

// 开启 Inspector
analytics.debug.inspector(true)

// 全部关闭
analytics.debug.disable()

// 全部开启
analytics.debug.enable({
  console: true,
  inspector: true
})
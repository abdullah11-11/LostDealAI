"use client";

import Script from "next/script";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head><Script src="/theme-init.js" strategy="beforeInteractive" /></head>
      <body className="bg-background text-content">
        <main className="flex min-h-screen items-center justify-center px-5">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-8 text-center">
            <p className="font-bold text-brand-strong">LostDeal AI</p>
            <h1 className="mt-3 text-2xl font-semibold">The application could not start</h1>
            <p className="mt-3 text-sm leading-6 text-secondary">Reload the application to try again.</p>
            <button onClick={reset} className="mt-6 min-h-10 rounded-lg border border-brand bg-brand px-4 text-sm font-bold text-on-brand">Reload Application</button>
          </div>
        </main>
      </body>
    </html>
  );
}

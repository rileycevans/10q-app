import type { Metadata } from "next";
import { Rubik, Bungee } from "next/font/google";
import "./globals.css";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { ToastProvider } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const rubik = Rubik({
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  variable: "--font-rubik",
  display: "swap",
});

const bungee = Bungee({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bungee",
  display: "swap",
});

export const metadata: Metadata = {
  title: "10Q - Daily Trivia Game",
  description: "A high-stakes daily trivia game. 10 questions. One attempt. Every day at 11:30 UTC.",
  metadataBase: new URL("https://play10q.com"),
  openGraph: {
    title: "10Q - Daily Trivia Game",
    description: "10 questions. One attempt. Every day at 11:30 UTC. How much do you really know?",
    url: "https://play10q.com",
    siteName: "10Q",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "10Q - Daily Trivia Game",
    description: "10 questions. One attempt. Every day at 11:30 UTC. How much do you really know?",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Warm the connection to Supabase as early as possible. The TLS+TCP
  // handshake to the edge-functions host costs ~50–150ms on a cold tab;
  // doing it during initial HTML parse means the first edge function call
  // (warm session, getCurrentQuiz, startAttempt) skips that handshake.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <html lang="en">
      <head>
        {supabaseUrl && (
          <>
            <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={supabaseUrl} />
          </>
        )}
      </head>
      <body className={`${rubik.variable} ${bungee.variable} font-body antialiased`}>
        <ErrorBoundary>
          <ToastProvider>
            <AnalyticsProvider>{children}</AnalyticsProvider>
          </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Rubik, Bungee } from "next/font/google";
import "./globals.css";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider } from "@/components/AuthProvider";
import { BackButtonHandler } from "@/components/BackButtonHandler";
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
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "10Q",
    // Matches --ink, so the iOS status bar blends with the app chrome.
    statusBarStyle: "black-translucent",
  },
};

// Brand purple behind the status/nav bars in installed and native shells.
export const viewport: Viewport = {
  themeColor: "#1A1A21",

  // Draw into the notch and home-indicator areas.
  //
  // This is a precondition, not a preference: until viewportFit is 'cover',
  // every env(safe-area-inset-*) resolves to 0px on iOS. Safe-area padding
  // added without it looks correct in devtools and does nothing on a device.
  viewportFit: "cover",

  // Pinch-zoom is currently enabled during a 12-second server-timed question,
  // where an accidental two-finger touch zooms the board mid-answer and there
  // is no time to recover. Disabled deliberately.
  //
  // The accessibility cost is real — this is the kind of thing WCAG 1.4.4
  // exists to prevent — but the app has no small text to enlarge, and the
  // failure it prevents costs a player their single daily attempt. Revisit if
  // dense text is ever added.
  maximumScale: 1,
  userScalable: false,
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
            <AuthProvider>
              <BackButtonHandler />
              <AnalyticsProvider>{children}</AnalyticsProvider>
            </AuthProvider>
          </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}

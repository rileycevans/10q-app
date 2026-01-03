import type { Metadata } from "next";
import { Rubik, Bungee } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${rubik.variable} ${bungee.variable} font-body antialiased`}>
        {children}
      </body>
    </html>
  );
}

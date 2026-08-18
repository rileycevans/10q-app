import type { MetadataRoute } from 'next';

/**
 * Web app manifest.
 *
 * Serves the installable-web-app case and doubles as the source of truth for
 * the native shells' name, colours and icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '10Q - Daily Trivia Game',
    short_name: '10Q',
    description:
      'A high-stakes daily trivia game. 10 questions. One attempt. Every day at 11:30 UTC.',
    start_url: '/',
    display: 'standalone',
    // Brand tokens from src/app/globals.css (--purpleA / --ink).
    background_color: '#413DE1',
    theme_color: '#1A1A21',
    orientation: 'portrait',
    categories: ['games', 'trivia', 'education'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // Android adaptive icons: art is inset so launcher masks can't clip it.
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

/**
 * Stub for next/dist/compiled/@vercel/og (used by OpenNext esbuild alias).
 * Drops WASM and the full OG stack from the Cloudflare Worker bundle.
 */
export class ImageResponse extends Response {
  constructor(..._args) {
    super(null, {
      status: 501,
      statusText: "OG image generation is not available in this deployment",
    });
  }
}

export async function experimental_FigmaImageResponse(_props) {
  return new ImageResponse();
}

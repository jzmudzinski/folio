/**
 * QR code generation for capability URLs.
 *
 * Used by `/p/<token>/qr.svg` to give the operator a scannable code for
 * the share URL — paste / show on screen / print and the recipient scans
 * with their phone camera. URL itself is the credential; QR is just a
 * visual delivery vector.
 *
 * We use the `qrcode` package (well-maintained, ~50M weekly downloads)
 * in SVG-string mode. Output is ~1.5KB for a typical share URL at
 * error-correction level M; renders crisply at any size since SVG.
 *
 * Color matches brand: ink-on-bg from the linen palette so the QR sits
 * comfortably next to the wordmark in printed pair-code instructions or
 * share dialogs.
 */

import QRCode from "qrcode";
import { BRAND } from "../core/brand";

export async function generateQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",   // 15% recoverable — fine for clean screen scans
    margin: 2,                   // quiet-zone modules around the matrix
    color: {
      dark: BRAND.ink,
      light: BRAND.bg,
    },
    width: 512,                  // logical SVG width; vector scales perfectly
  });
}

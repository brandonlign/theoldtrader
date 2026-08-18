import "./hosted.css";
import "./desks.css";

export const metadata = {
  title: "TheOldTrader — Polymarket + Crypto Paper Desks",
  description: "Two separate Cloudflare-backed paper-trading desks for prediction markets and 24/7 crypto research."
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}

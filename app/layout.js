import "./hosted.css";

export const metadata = {
  title: "MoneyMog — Hosted Paper Trading Desk",
  description: "A shared Cloudflare-backed paper portfolio for conservative prediction-market research."
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}

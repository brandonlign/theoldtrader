import "./globals.css";
import "./whales.css";
import "./readiness.css";

export const metadata = {
  title: "MoneyMog — Paper Trading Desk",
  description: "A paper-first Polymarket arbitrage and whale-monitoring dashboard."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

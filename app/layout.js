import "./globals.css";
import "./whales.css";

export const metadata = {
  title: "MoneyMog — Paper Trading Desk",
  description: "A paper-first Polymarket structural-arbitrage and whale-monitoring dashboard."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

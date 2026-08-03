import "./globals.css";

export const metadata = {
  title: "MoneyMog — Paper Trading Desk",
  description: "A paper-first Polymarket structural-arbitrage dashboard."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

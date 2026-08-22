# Trial 8 primary-source record

This note records the first-party sources used to freeze `bitnomial-carry-v1`. Source claims motivate/define mechanism and implementation; they are not Trial 8 return evidence.

## Bitnomial

- Exchange/regulatory: `https://bitnomial.com/exchange/`
  - Bitnomial Exchange is a CFTC-registered Designated Contract Market.
  - Current Bitcoin/Crypto Complex exchange+clearing fee for non-participants is $0.10 per contract per side.
- PBTCUC product specification: `https://bitnomial.com/exchange/rulebook/product/crypto/pbtcuc/`
  - Bitcoin US Dollar Centi Perpetual Futures.
  - Product code PBTCUC.
  - Contract size 0.01 BTC.
  - $5/BTC tick size.
  - Perpetually priced/margined/settled every eight hours.
- Product REST docs: `https://bitnomial.com/exchange/docs/api/rest/products/`
  - public `/product/specs/` and `/product/data/:product_id` endpoints;
  - `product_status` supports `active`;
  - product-data price fields are ticks and convert to USD by multiplying by `price_increment`.
- Funding REST docs: `https://bitnomial.com/exchange/docs/api/rest/funding-rates/`
  - public historical funding endpoint;
  - regular intervals 00:00, 08:00, 16:00 UTC;
  - positive funding means longs pay shorts;
  - response includes product ID, price index, mark price, interest rate, funding rate and interval timestamps.
- Perpetual pricing docs: `https://bitnomial.com/exchange/docs/market-operations/settlements/digital-asset-perpetual-pricing/`
  - funding is part of perpetual variation-margin mechanics and is calculated every eight hours.
- Clearinghouse margin page: `https://bitnomial.com/clearinghouse`
  - BTCUC currently lists 15% maintenance margin; Trial 8 freezes 15% as its research threshold even if venue requirements later change.

## Coinbase

- Public BTC-USD ticker: `https://api.exchange.coinbase.com/products/BTC-USD/ticker`
  - supplies first-party bid, ask, last price and timestamp.
- Coinbase Exchange / Advanced fee documentation is the source for the frozen conservative low-volume 60-bps taker assumption. Trial 8 additionally charges 10 bps adverse slippage per spot order and does not attempt to claim a lower account tier.

## Interpretation constraint

No historical Bitnomial or Coinbase return series from these sources was used to tune Trial 8. The candidate is scored only on the prospectively declared window beginning 2026-08-20T02:00:00Z.

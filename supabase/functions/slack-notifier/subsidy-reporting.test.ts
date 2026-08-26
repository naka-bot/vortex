import { describe, expect, test } from "bun:test";
import {
  buildCompletionAttributionFields,
  buildQuoteAttributionFields,
  chunkFields,
  hasQuoteAttribution,
  notificationKind,
  type SubsidyQuote
} from "./subsidy-reporting";

const quote: SubsidyQuote = {
  input_amount: "1000",
  metadata: {
    globals: { fees: { usd: { vortex: "3.5" } } },
    nablaSwapEvm: {
      effectiveExchangeRate: "0.198",
      inputAmountForSwapDecimal: "1000",
      oraclePrice: "0.2",
      outputAmountDecimal: "198",
      outputCurrency: "USDC"
    },
    partner: { targetDiscount: "0.0005" },
    subsidy: {
      adjustedDifference: "0.00005",
      adjustedTargetDiscount: "0.00055",
      expectedOutputAmountDecimal: "200.11",
      idealSubsidyAmountInOutputTokenDecimal: "12",
      subsidyAmountInOutputTokenDecimal: "10"
    }
  },
  output_amount: "200",
  output_currency: "USDT"
};

const blockQuote: SubsidyQuote = {
  input_amount: "25013",
  metadata: {
    blocks: {
      distributeFees: { vortexFeeUsd: "16.77170935" },
      nablaSwap: {
        effectiveExchangeRate: "0.1911",
        inputAmountForSwapDecimal: "25012.249841",
        oraclePrice: "0.19156721135610428919",
        outputAmountDecimal: "4781.873581",
        outputCurrency: "USDC"
      },
      subsidizePostSwap: {
        adjustedDifference: "0.00005",
        adjustedTargetDiscount: "0.00055",
        expectedOutputAmountDecimal: "4792.69583997510728398798",
        idealSubsidyAmountInOutputTokenDecimal: "27.65310432510728398798",
        outputCurrency: "USDC",
        subsidyAmountInOutputTokenDecimal: "27.65310432510728398798"
      }
    },
    globals: {
      partner: { targetDiscount: "0.0005" }
    }
  },
  output_amount: "4794.306136747407417737",
  output_currency: "USDT"
};

const alfredpayQuote: SubsidyQuote = {
  input_amount: "100",
  metadata: {
    blocks: {
      alfredpayOfframp: {
        adjustedDifference: "0",
        adjustedTargetDiscount: "0.001",
        pricing: {
          customer: { allInRate: "17.017", inputAmountUsd: "100", referenceDifferenceBps: "10" },
          provider: { baseCurrency: "USDT", netReferenceDifferenceBps: "25" },
          reference: { rate: "17", source: "fastforex" }
        },
        subsidyAmountDecimal: "5.75"
      },
      distributeFees: { vortexFeeUsd: "0.35" }
    },
    globals: { partner: { targetDiscount: "0.001" } }
  },
  output_amount: "1701.70",
  output_currency: "MXN"
};

describe("subsidy reporting", () => {
  test("shows quote-time discount, DEX gap, clipping and net subsidy", () => {
    const fields = buildQuoteAttributionFields("BUY", quote);
    expect(fields.find(field => field.label.includes("Configured"))?.value).toContain("+5.00 bps");
    expect(fields.find(field => field.label.includes("DEX"))?.value).toBe("-100.00 bps");
    expect(fields.find(field => field.label.includes("Cap"))?.value).toContain("2.000000 USDC");
    expect(fields.find(field => field.label.includes("net subsidy"))?.value).toBe(
      "+6.500000 USD (+324.82 bps net)"
    );
  });

  test("separates execution discrepancy from final settlement", () => {
    const fields = buildCompletionAttributionFields(quote, [
      { amount: "9.5", phase: "subsidizePostSwap", token: "USDC" },
      { amount: "0.12", phase: "finalSettlementSubsidy", token: "USDT" }
    ]);
    expect(fields[0].value).toContain("-0.500000 USDC");
    expect(fields[1].value).toBe("0.120000 USDT");
  });

  test("reads current block-based quote metadata and prefers precise swap amounts", () => {
    const fields = buildQuoteAttributionFields("BUY", blockQuote);
    expect(fields.find(field => field.label.includes("Configured"))?.value).toContain("+5.50 bps");
    expect(fields.find(field => field.label.includes("DEX"))?.value).toBe("-20.15 bps");
    expect(fields.find(field => field.label.includes("Quote subsidy"))?.value).toContain("27.653104 USDC");
  });

  test("reads AlfredPay pricing and settlement subsidy metadata without NaN placeholders", () => {
    const fields = buildQuoteAttributionFields("SELL", alfredpayQuote);
    expect(fields.find(field => field.label.includes("Configured"))?.value).toContain("+10.00 bps");
    expect(fields.find(field => field.label.includes("provider vs reference"))?.value).toBe("+25.00 bps");
    expect(fields.find(field => field.label.includes("Customer vs reference"))?.value).toBe("+10.00 bps");
    expect(fields.find(field => field.label.includes("settlement subsidy"))?.value).toBe(
      "5.750000 USDT (575.00 bps gross)"
    );
    expect(fields.find(field => field.label.includes("net subsidy"))?.value).toBe(
      "+5.400000 USD (+540.00 bps net)"
    );
    expect(fields.every(field => !String(field.value).match(/NaN|undefined|_N\/A_/))).toBe(true);
    expect(hasQuoteAttribution(alfredpayQuote)).toBe(true);
  });

  test("reports configured negative targets as attribution-worthy", () => {
    expect(
      hasQuoteAttribution({
        ...quote,
        metadata: { ...quote.metadata, partner: { targetDiscount: "-0.0006" }, subsidy: undefined }
      })
    ).toBe(true);
  });

  test("prioritizes terminal alerts over the initial-to-active alert", () => {
    expect(notificationKind("initial", "failed")).toBe("failed");
    expect(notificationKind("initial", "complete")).toBe("complete");
    expect(notificationKind("initial", "alfredpayOfframpTransfer")).toBe("started");
    expect(notificationKind("initial", "timedOut")).toBeUndefined();
    expect(notificationKind("complete", "complete")).toBeUndefined();
  });

  test("chunks Slack fields at the platform limit", () => {
    expect(chunkFields(Array.from({ length: 21 }, (_, index) => ({ label: `${index}`, value: index })))).toHaveLength(3);
  });
});

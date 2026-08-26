export type SlackField = {
  label: string;
  value: string | number | undefined;
};

export type RampDirection = "BUY" | "SELL" | string;

export type NotificationKind = "complete" | "failed" | "started";

export type SubsidyRow = {
  amount: number | string;
  phase: string;
  token: string;
};

export type SubsidyQuote = {
  input_amount: number | string;
  metadata: {
    blocks?: {
      alfredpayOfframp?: AlfredpayOfframpMetadata;
      distributeFees?: {
        vortexFeeUsd?: number | string;
      };
      finalSettlementSubsidy?: DiscountSubsidyMetadata;
      nablaSwap?: SwapMetadata;
      subsidizePostSwap?: DiscountSubsidyMetadata;
    };
    fees?: {
      displayFiat?: {
        currency?: string;
        vortex?: number | string;
      };
      usd?: {
        vortex?: number | string;
      };
    };
    globals?: {
      fees?: FeeMetadata;
      partner?: PartnerMetadata;
    };
    nablaSwap?: SwapMetadata;
    nablaSwapEvm?: SwapMetadata;
    partner?: PartnerMetadata;
    subsidy?: DiscountSubsidyMetadata;
  };
  output_amount: number | string;
  output_currency: string;
};

type FeeMetadata = {
  displayFiat?: {
    currency?: string;
    vortex?: number | string;
  };
  usd?: {
    vortex?: number | string;
  };
};

type PartnerMetadata = {
  targetDiscount?: number | string;
};

type DiscountSubsidyMetadata = {
  adjustedDifference?: number | string;
  adjustedTargetDiscount?: number | string;
  expectedOutputAmountDecimal?: number | string;
  idealSubsidyAmountInOutputTokenDecimal?: number | string;
  outputCurrency?: string;
  subsidyAmountInOutputTokenDecimal?: number | string;
};

type SwapMetadata = {
  effectiveExchangeRate?: number | string;
  inputAmountForSwapDecimal?: number | string;
  oraclePrice?: number | string;
  outputAmountDecimal?: number | string;
  outputCurrency?: string;
};

type AlfredpayOfframpMetadata = {
  adjustedDifference?: number | string;
  adjustedTargetDiscount?: number | string;
  pricing?: {
    customer?: {
      allInRate?: number | string;
      inputAmountUsd?: number | string;
      referenceDifferenceBps?: number | string;
    };
    provider?: {
      baseCurrency?: string;
      netReferenceDifferenceBps?: number | string;
    };
    reference?: {
      rate?: number | string;
      source?: string;
    };
  };
  subsidyAmountDecimal?: number | string;
};

const EPSILON = 1e-9;

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function signed(value: number, decimals = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

function amount(value: number, decimals = 6): string {
  return value.toFixed(decimals);
}

function bps(numerator: number, denominator: number | undefined): number | undefined {
  if (!denominator || denominator <= 0) return undefined;
  return (numerator / denominator) * 10_000;
}

export function swapMetadata(quote: SubsidyQuote): SwapMetadata | undefined {
  return quote.metadata.blocks?.nablaSwap || quote.metadata.nablaSwapEvm || quote.metadata.nablaSwap;
}

export function partnerMetadata(quote: SubsidyQuote): PartnerMetadata {
  return quote.metadata.globals?.partner || quote.metadata.partner || {};
}

export function subsidyMetadata(quote: SubsidyQuote): DiscountSubsidyMetadata {
  return quote.metadata.blocks?.subsidizePostSwap || quote.metadata.subsidy || {};
}

export function feeMetadata(quote: SubsidyQuote): FeeMetadata {
  return quote.metadata.globals?.fees || quote.metadata.fees || {};
}

function quoteSubsidyCurrency(quote: SubsidyQuote): string {
  return subsidyMetadata(quote).outputCurrency || swapMetadata(quote)?.outputCurrency || quote.output_currency;
}

function alfredpayMetadata(quote: SubsidyQuote): AlfredpayOfframpMetadata | undefined {
  return quote.metadata.blocks?.alfredpayOfframp;
}

export function vortexFeeUsd(quote: SubsidyQuote): number | undefined {
  return finiteNumber(
    feeMetadata(quote).usd?.vortex ?? quote.metadata.blocks?.distributeFees?.vortexFeeUsd ?? quote.metadata.fees?.usd?.vortex
  );
}

export function buildQuoteAttributionFields(rampType: RampDirection, quote: SubsidyQuote): SlackField[] {
  const partner = partnerMetadata(quote);
  const subsidy = subsidyMetadata(quote);
  const swap = swapMetadata(quote);
  const alfredpay = alfredpayMetadata(quote);
  const targetDiscount = finiteNumber(partner.targetDiscount) ?? 0;
  const dynamicAdjustment = finiteNumber(alfredpay?.adjustedDifference ?? subsidy.adjustedDifference) ?? 0;
  const adjustedDiscount =
    finiteNumber(alfredpay?.adjustedTargetDiscount ?? subsidy.adjustedTargetDiscount) ?? targetDiscount + dynamicAdjustment;
  if (alfredpay) {
    const inputAmountUsd = finiteNumber(alfredpay.pricing?.customer?.inputAmountUsd);
    const providerDifferenceBps = finiteNumber(alfredpay.pricing?.provider?.netReferenceDifferenceBps);
    const customerDifferenceBps = finiteNumber(alfredpay.pricing?.customer?.referenceDifferenceBps);
    const quotedSubsidyUsd = finiteNumber(alfredpay.subsidyAmountDecimal) ?? 0;
    const quotedSubsidyBps = bps(quotedSubsidyUsd, inputAmountUsd);
    const feeUsd = vortexFeeUsd(quote);
    const netSubsidyUsd = quotedSubsidyUsd - (feeUsd ?? 0);
    const netSubsidyBps = bps(netSubsidyUsd, inputAmountUsd);
    const subsidyCurrency = alfredpay.pricing?.provider?.baseCurrency || "USD";

    const fields: SlackField[] = [
      {
        label: "🎯 Configured discount",
        value: `${signed(targetDiscount * 10_000)} bps + dynamic ${signed(dynamicAdjustment * 10_000)} bps = ${signed(adjustedDiscount * 10_000)} bps`
      },
      {
        label: "📉 AlfredPay provider vs reference (quote time)",
        value: providerDifferenceBps === undefined ? "_Not available_" : `${signed(providerDifferenceBps)} bps`
      },
      {
        label: "📊 Customer vs reference (quote time)",
        value: customerDifferenceBps === undefined ? "_Not available_" : `${signed(customerDifferenceBps)} bps`
      },
      {
        label: "💸 AlfredPay settlement subsidy (quoted)",
        value: `${amount(quotedSubsidyUsd)} ${subsidyCurrency}${quotedSubsidyBps === undefined ? "" : ` (${quotedSubsidyBps.toFixed(2)} bps gross)`}`
      }
    ];

    if (feeUsd !== undefined) {
      fields.push({
        label: "🧮 Quote net subsidy after Vortex fee",
        value: `${signed(netSubsidyUsd, 6)} USD${netSubsidyBps === undefined ? "" : ` (${signed(netSubsidyBps)} bps net)`}`
      });
    }
    return fields;
  }

  const expectedOutput = finiteNumber(subsidy.expectedOutputAmountDecimal);
  const idealSubsidy = finiteNumber(subsidy.idealSubsidyAmountInOutputTokenDecimal) ?? 0;
  const quoteSubsidy = finiteNumber(subsidy.subsidyAmountInOutputTokenDecimal) ?? 0;
  const currency = quoteSubsidyCurrency(quote);
  const oraclePrice = finiteNumber(swap?.oraclePrice);
  const oracleRate = oraclePrice && oraclePrice > 0 ? (rampType === "SELL" ? 1 / oraclePrice : oraclePrice) : undefined;
  const preciseSwapRate = (() => {
    const swapInput = finiteNumber(swap?.inputAmountForSwapDecimal);
    const swapOutput = finiteNumber(swap?.outputAmountDecimal);
    return swapInput && swapOutput !== undefined ? swapOutput / swapInput : undefined;
  })();
  // Prefer raw amounts: effectiveExchangeRate is rounded for display in newer quote metadata.
  const effectiveExchangeRate = preciseSwapRate ?? finiteNumber(swap?.effectiveExchangeRate);
  const dexGapBps =
    oracleRate && effectiveExchangeRate !== undefined ? (effectiveExchangeRate / oracleRate - 1) * 10_000 : undefined;
  const clipped = Math.max(0, idealSubsidy - quoteSubsidy);
  const clippedBps = bps(clipped, expectedOutput);
  const quoteSubsidyBps = bps(quoteSubsidy, expectedOutput);
  const feeUsd = vortexFeeUsd(quote);
  const quoteNetUsd =
    quoteSubsidyCurrency(quote) === "USDC" || quoteSubsidyCurrency(quote) === "USDT" ? quoteSubsidy - (feeUsd ?? 0) : undefined;
  const quoteNetBps = quoteNetUsd === undefined ? undefined : bps(quoteNetUsd, expectedOutput);

  const fields: SlackField[] = [
    {
      label: "🎯 Configured discount",
      value: `${signed(targetDiscount * 10_000)} bps + dynamic ${signed(dynamicAdjustment * 10_000)} bps = ${signed(adjustedDiscount * 10_000)} bps`
    },
    {
      label: "📉 DEX vs oracle (quote time)",
      value: dexGapBps === undefined ? "_N/A_" : `${signed(dexGapBps)} bps`
    },
    {
      label: "✂️ Cap clipping",
      value: `${amount(clipped)} ${currency}${clippedBps === undefined ? "" : ` (${clippedBps.toFixed(2)} bps)`}${clipped > EPSILON ? " — capped" : ""}`
    },
    {
      label: "💸 Quote subsidy",
      value: `${amount(quoteSubsidy)} ${currency}${quoteSubsidyBps === undefined ? "" : ` (${quoteSubsidyBps.toFixed(2)} bps gross)`}`
    }
  ];

  if (quoteNetUsd !== undefined) {
    fields.push({
      label: "🧮 Quote net subsidy after Vortex fee",
      value: `${signed(quoteNetUsd, 6)} USD${quoteNetBps === undefined ? "" : ` (${signed(quoteNetBps)} bps net)`}`
    });
  }

  return fields;
}

export function hasQuoteAttribution(quote: SubsidyQuote): boolean {
  const targetDiscount = finiteNumber(partnerMetadata(quote).targetDiscount) ?? 0;
  const quoteSubsidy = finiteNumber(subsidyMetadata(quote).subsidyAmountInOutputTokenDecimal) ?? 0;
  const alfredpaySubsidy = finiteNumber(alfredpayMetadata(quote)?.subsidyAmountDecimal) ?? 0;
  return targetDiscount !== 0 || quoteSubsidy !== 0 || alfredpaySubsidy !== 0;
}

export function notificationKind(oldPhase: string | undefined, newPhase: string | undefined): NotificationKind | undefined {
  if (newPhase === "failed" && oldPhase !== "failed") return "failed";
  if (newPhase === "complete" && oldPhase !== "complete") return "complete";
  if (oldPhase === "initial" && newPhase !== "initial" && newPhase !== "timedOut") return "started";
  return undefined;
}

function sumPhase(rows: SubsidyRow[], phase: string, token?: string): number {
  return rows
    .filter(row => row.phase.toLowerCase() === phase.toLowerCase() && (!token || row.token === token))
    .reduce((sum, row) => sum + (finiteNumber(row.amount) ?? 0), 0);
}

function formatPhaseRows(rows: SubsidyRow[], phase: string): string {
  const totals = new Map<string, number>();
  for (const row of rows.filter(row => row.phase.toLowerCase() === phase.toLowerCase())) {
    totals.set(row.token, (totals.get(row.token) ?? 0) + (finiteNumber(row.amount) ?? 0));
  }
  if (totals.size === 0) return "0";
  return [...totals.entries()].map(([token, value]) => `${amount(value)} ${token}`).join(" + ");
}

export function buildCompletionAttributionFields(quote: SubsidyQuote, rows: SubsidyRow[]): SlackField[] {
  const subsidy = subsidyMetadata(quote);
  const quoteSubsidy = finiteNumber(subsidy.subsidyAmountInOutputTokenDecimal) ?? 0;
  const expectedOutput = finiteNumber(subsidy.expectedOutputAmountDecimal);
  const currency = quoteSubsidyCurrency(quote);
  const postSwapPaid = sumPhase(rows, "subsidizePostSwap", currency);
  const executionDifference = postSwapPaid - quoteSubsidy;
  const executionBps = bps(executionDifference, expectedOutput);
  return [
    {
      label: "📊 Quote → execution discrepancy",
      value: `${signed(executionDifference, 6)} ${currency}${executionBps === undefined ? "" : ` (${signed(executionBps)} bps)`}`
    },
    {
      label: "🏁 Final-settlement subsidy",
      value: formatPhaseRows(rows, "finalSettlementSubsidy")
    }
  ];
}

export function chunkFields(fields: SlackField[], size = 10): SlackField[][] {
  const chunks: SlackField[][] = [];
  for (let index = 0; index < fields.length; index += size) {
    chunks.push(fields.slice(index, index + size));
  }
  return chunks;
}

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCompletionAttributionFields,
  buildQuoteAttributionFields,
  chunkFields,
  hasQuoteAttribution,
  notificationKind,
  type SlackField,
  type SubsidyQuote,
  type SubsidyRow
} from "./subsidy-reporting.ts";

function trimToSixDecimals(floatStr: string | number) {
  const num = parseFloat(String(floatStr));
  if (isNaN(num)) {
    return floatStr;
  }
  return num.toFixed(6);
}

const techiesGroupId = "S03GPNXTM7A";

const fieldIcons = {
  session: "🧾",
  tax: "🏛️",
  wallet: "👛"
};

type RampRecord = {
  current_phase?: string;
  from: string;
  id: string;
  quote_id: string;
  state?: {
    destinationAddress?: string;
    sessionId?: string;
    taxId?: string;
    userId?: string;
    walletAddress?: string;
  };
  to: string;
  type: string;
  user_id?: string;
};

type Quote = SubsidyQuote & {
  input_currency: string;
};

function formatSlackMessage(
  record: RampRecord,
  quote: Quote,
  title?: string,
  includeFields = false,
  extraFields: SlackField[] = []
) {
  const { type: rampType, from: fromParam, to: toParam, state = {} } = record;
  const { taxId, sessionId, userId, walletAddress, destinationAddress } = state;

  const inputAmount = quote.input_amount;
  const inputCurrency = quote.input_currency;
  const outputAmount = quote.output_amount;
  const outputCurrency = quote.output_currency;

  const finalWalletAddress = walletAddress || destinationAddress;

  const fields: SlackField[] = [];
  if (finalWalletAddress) {
    fields.push({
      label: `${fieldIcons.wallet} Wallet Address`,
      value: finalWalletAddress
    });
  }
  const finalUserId = record.user_id || userId || sessionId;
  if (finalUserId) {
    fields.push({
      label: `${fieldIcons.session} User ID`,
      value: finalUserId
    });
  }

  if (taxId) {
    fields.push({
      label: `${fieldIcons.tax} Tax ID`,
      value: taxId
    });
  }

  if (hasQuoteAttribution(quote)) {
    fields.push(...buildQuoteAttributionFields(rampType, quote));
  }

  fields.push(...extraFields);

  const blocks: Array<Record<string, unknown>> = [
    {
      text: {
        text: `${title || "*🚀 Ramp Transaction Details*"}\n_Production_`,
        type: "mrkdwn"
      },
      type: "section"
    },
    {
      text: {
        text: `*${rampType}* ${trimToSixDecimals(inputAmount)} ${inputCurrency} \`${fromParam}\` ➜ *${trimToSixDecimals(outputAmount)} ${outputCurrency}* \`${toParam}\``,
        type: "mrkdwn"
      },
      type: "section"
    }
  ];

  if (includeFields) {
    blocks.push({ type: "divider" });
    for (const fieldChunk of chunkFields(fields)) {
      blocks.push({
        fields: fieldChunk.map(field => ({
          text: `*${field.label}:*\n${field.value ?? "_N/A_"}`,
          type: "mrkdwn"
        })),
        type: "section"
      });
    }
  }

  return { blocks };
}

Deno.serve(async req => {
  try {
    const payload = await req.json();
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") ?? ""
        }
      }
    });
    const type = payload.type;
    const record = payload.record as RampRecord;
    const oldRecord = payload.old_record as RampRecord;
    let slackPayload;
    const quoteId = record.quote_id;
    const { data: quote, error } = await supabaseClient.from("quote_tickets").select("*").eq("id", quoteId).single();
    if (error) {
      throw new Error(`Couldn't find quote in table: ${error.message}`);
    }
    if (type === "UPDATE") {
      const notification = notificationKind(oldRecord.current_phase, record.current_phase);
      if (notification === "failed") {
        slackPayload = formatSlackMessage(
          record,
          quote as Quote,
          `🚨 <!subteam^${techiesGroupId}>: *Ramp \`${record.id}\` got stuck in state \`${oldRecord.current_phase}\`*`,
          true
        );
      } else if (notification === "complete") {
        const { data: subsidyRows, error: subsidyError } = await supabaseClient
          .from("subsidies")
          .select("amount,phase,token")
          .eq("ramp_id", record.id);
        if (subsidyError) {
          console.error("Couldn't load completed-ramp subsidies:", subsidyError);
        }
        const completionFields = subsidyError
          ? []
          : buildCompletionAttributionFields(quote as Quote, (subsidyRows ?? []) as SubsidyRow[]);
        slackPayload = formatSlackMessage(
          record,
          quote as Quote,
          `✅ *Ramp \`${record.id}\` completed successfully*`,
          true,
          completionFields
        );
      } else if (notification === "started") {
        slackPayload = formatSlackMessage(record, quote as Quote, `▶️ *Ramp \`${record.id}\` started*`, true);
      }
    }

    if (!slackPayload) {
      return new Response(null, { status: 204 });
    }
    const slackWebhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    if (!slackWebhookUrl) {
      throw new Error("SLACK_WEBHOOK_URL is not configured");
    }
    console.log("Sending Message to Slack");
    const slackResponse = await fetch(slackWebhookUrl, {
      body: JSON.stringify(slackPayload),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    if (!slackResponse.ok) {
      throw new Error(`Slack webhook failed with HTTP ${slackResponse.status}`);
    }
    return new Response(
      JSON.stringify({
        message: "Success"
      }),
      {
        headers: {
          "Content-Type": "application/json"
        },
        status: 200
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        message: err instanceof Error ? err.message : err
      }),
      {
        headers: {
          "Content-Type": "application/json"
        },
        status: 500
      }
    );
  }
});

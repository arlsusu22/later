import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Environment,
  SignedDataVerifier
} from "@apple/app-store-server-library";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appleRootCertificates = [
  readFileSync(path.join(__dirname, "..", "certs", "AppleRootCA-G3.cer")),
  readFileSync(path.join(__dirname, "..", "certs", "AppleRootCA-G2.cer")),
  readFileSync(path.join(__dirname, "..", "certs", "AppleIncRootCertificate.cer"))
];

const bundleId = process.env.APP_BUNDLE_ID || "com.arlindsusuri.later";
const appAppleId = Number(process.env.APP_APPLE_ID || "6761394122");

const productionVerifier = new SignedDataVerifier(
  appleRootCertificates,
  true,
  Environment.PRODUCTION,
  bundleId,
  appAppleId
);

const sandboxVerifier = new SignedDataVerifier(
  appleRootCertificates,
  true,
  Environment.SANDBOX,
  bundleId
);

async function verifyNotification(signedPayload) {
  try {
    return await productionVerifier.verifyAndDecodeNotification(signedPayload);
  } catch (productionError) {
    try {
      return await sandboxVerifier.verifyAndDecodeNotification(signedPayload);
    } catch (sandboxError) {
      sandboxError.productionError = productionError;
      throw sandboxError;
    }
  }
}

async function verifyTransaction(signedTransactionInfo, environment) {
  const verifier =
    environment === "Sandbox" || environment === "SANDBOX"
      ? sandboxVerifier
      : productionVerifier;

  return verifier.verifyAndDecodeTransaction(signedTransactionInfo);
}

async function sendSlack(text) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    return;
  }

  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed with HTTP ${response.status}`);
  }
}

async function sendTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
  }
}

async function sendAlert(text) {
  if (!process.env.SLACK_WEBHOOK_URL && !process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "Missing alert destination. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, or SLACK_WEBHOOK_URL."
    );
  }

  await Promise.all([
    sendTelegram(text),
    sendSlack(text)
  ]);
}

const storefrontToCountryCode = {
  ABW: "AW",
  AFG: "AF",
  AGO: "AO",
  AIA: "AI",
  ALB: "AL",
  AND: "AD",
  ARE: "AE",
  ARG: "AR",
  ARM: "AM",
  ATG: "AG",
  AUS: "AU",
  AUT: "AT",
  AZE: "AZ",
  BEL: "BE",
  BEN: "BJ",
  BFA: "BF",
  BGR: "BG",
  BHR: "BH",
  BHS: "BS",
  BLR: "BY",
  BLZ: "BZ",
  BMU: "BM",
  BOL: "BO",
  BRA: "BR",
  BRB: "BB",
  BRN: "BN",
  BTN: "BT",
  BWA: "BW",
  CAN: "CA",
  CHE: "CH",
  CHL: "CL",
  CHN: "CN",
  COL: "CO",
  CPV: "CV",
  CRI: "CR",
  CYP: "CY",
  CZE: "CZ",
  DEU: "DE",
  DMA: "DM",
  DNK: "DK",
  DOM: "DO",
  DZA: "DZ",
  ECU: "EC",
  EGY: "EG",
  ESP: "ES",
  EST: "EE",
  FIN: "FI",
  FRA: "FR",
  GBR: "GB",
  GEO: "GE",
  GHA: "GH",
  GRC: "GR",
  GTM: "GT",
  HKG: "HK",
  HRV: "HR",
  HUN: "HU",
  IDN: "ID",
  IND: "IN",
  IRL: "IE",
  ISL: "IS",
  ISR: "IL",
  ITA: "IT",
  JAM: "JM",
  JPN: "JP",
  KEN: "KE",
  KHM: "KH",
  KOR: "KR",
  KWT: "KW",
  KAZ: "KZ",
  LAO: "LA",
  LBN: "LB",
  LKA: "LK",
  LTU: "LT",
  LUX: "LU",
  LVA: "LV",
  MAC: "MO",
  MAR: "MA",
  MDA: "MD",
  MDG: "MG",
  MEX: "MX",
  MKD: "MK",
  MLI: "ML",
  MLT: "MT",
  MYS: "MY",
  NER: "NE",
  NGA: "NG",
  NLD: "NL",
  NOR: "NO",
  NPL: "NP",
  NZL: "NZ",
  OMN: "OM",
  PAK: "PK",
  PAN: "PA",
  PER: "PE",
  PHL: "PH",
  POL: "PL",
  PRT: "PT",
  PRY: "PY",
  QAT: "QA",
  ROU: "RO",
  SAU: "SA",
  SEN: "SN",
  SGP: "SG",
  SLV: "SV",
  SRB: "RS",
  SVK: "SK",
  SVN: "SI",
  SWE: "SE",
  THA: "TH",
  TUN: "TN",
  TUR: "TR",
  TWN: "TW",
  TZA: "TZ",
  UGA: "UG",
  UKR: "UA",
  URY: "UY",
  USA: "US",
  UZB: "UZ",
  VEN: "VE",
  VNM: "VN",
  ZAF: "ZA"
};

function countryFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return "";
  }

  return countryCode
    .toUpperCase()
    .replace(/./g, (character) =>
      String.fromCodePoint(127397 + character.charCodeAt(0))
    );
}

function formatCountry(storefront) {
  if (!storefront) {
    return "Unknown";
  }

  const normalizedStorefront = storefront.toUpperCase();
  const countryCode =
    normalizedStorefront.length === 2
      ? normalizedStorefront
      : storefrontToCountryCode[normalizedStorefront];
  const flag = countryFlag(countryCode);

  return [flag, normalizedStorefront].filter(Boolean).join(" ");
}

function messageTitle(notificationType, environment) {
  if (notificationType === "REFUND") {
    return "↩️Refund";
  }

  if (environment === "Sandbox" || environment === "SANDBOX") {
    return "💰New purchase in sandbox!";
  }

  return "💰New purchase!";
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    response.status(200).send("ok");
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    response.status(405).send("Method not allowed");
    return;
  }

  try {
    const signedPayload = request.body?.signedPayload;

    if (!signedPayload) {
      response.status(400).send("Missing signedPayload");
      return;
    }

    const notification = await verifyNotification(signedPayload);
    const {
      notificationType,
      subtype,
      notificationUUID,
      data
    } = notification;

    if (notificationType === "TEST") {
      await sendAlert(
        [
          "Apple IAP webhook test received",
          `Bundle ID: ${bundleId}`,
          `Notification: ${notificationUUID}`
        ].join("\n")
      );
      response.status(200).send("ok");
      return;
    }

    if (
      !["ONE_TIME_CHARGE", "REFUND"].includes(notificationType) ||
      !data?.signedTransactionInfo
    ) {
      response.status(200).send("ignored");
      return;
    }

    const transaction = await verifyTransaction(
      data.signedTransactionInfo,
      data.environment
    );

    await sendAlert(
      [
        messageTitle(notificationType, data.environment),
        "",
        "Product: Later Unlimited",
        `Country: ${formatCountry(transaction.storefront)}`
      ].join("\n")
    );

    response.status(200).send("ok");
  } catch (error) {
    console.error("Apple IAP webhook error:", error);
    response.status(500).send("Webhook error");
  }
}

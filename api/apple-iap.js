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

function isPurchaseEvent(notificationType) {
  return [
    "ONE_TIME_CHARGE",
    "SUBSCRIBED",
    "DID_RENEW"
  ].includes(notificationType);
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

    if (!isPurchaseEvent(notificationType) || !data?.signedTransactionInfo) {
      response.status(200).send("ignored");
      return;
    }

    const transaction = await verifyTransaction(
      data.signedTransactionInfo,
      data.environment
    );

    await sendAlert(
      [
        "New App Store purchase",
        `Type: ${notificationType}${subtype ? ` / ${subtype}` : ""}`,
        `Product: ${transaction.productId || "unknown"}`,
        `Transaction: ${transaction.transactionId || "unknown"}`,
        `Original transaction: ${transaction.originalTransactionId || "unknown"}`,
        `Environment: ${data.environment || "unknown"}`,
        `Notification: ${notificationUUID}`
      ].join("\n")
    );

    response.status(200).send("ok");
  } catch (error) {
    console.error("Apple IAP webhook error:", error);
    response.status(500).send("Webhook error");
  }
}

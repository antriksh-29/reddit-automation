import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/**
 * Amazon SES email client.
 * Ref: TECH-SPEC.md §11 (Email Service), PRODUCT-SPEC.md §6.4
 *
 * Emails are batched per user per scan cycle — one email with all qualifying alerts.
 * SES sandbox mode: can only send to verified emails until production access is approved.
 */

const ses = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || "user-alerts@getarete.co";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.getarete.co";

export interface AlertEmailData {
  postTitle: string;
  postUrl: string;
  subreddit: string;
  category: string;
  priorityLevel: string;
  priorityScore: number;
  upvotes: number;
  numComments: number;
  postBody?: string;
  timeAgo: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  pain_point: "Pain Point",
  solution_request: "Solution Request",
  competitor_dissatisfaction: "Competitor Dissatisfaction",
  experience_sharing: "Experience Sharing",
  industry_discussion: "Industry Discussion",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#6B6B68",
};

const PRIORITY_EMOJI: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "⚪",
};

/**
 * Send a single batched email with all alerts from a scan cycle.
 * One email per user, containing all qualifying alerts.
 */
export async function sendBatchedAlertEmail(
  toEmail: string,
  businessName: string,
  alerts: AlertEmailData[]
): Promise<boolean> {
  if (alerts.length === 0) return true;

  const highCount = alerts.filter((a) => a.priorityLevel === "high").length;
  const mediumCount = alerts.filter((a) => a.priorityLevel === "medium").length;
  const lowCount = alerts.filter((a) => a.priorityLevel === "low").length;

  // Subject line
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC
  const subject = `New Arete Alerts for ${businessName} - ${today}`;

  // Summary line
  const parts: string[] = [];
  if (highCount > 0) parts.push(`${highCount} high`);
  if (mediumCount > 0) parts.push(`${mediumCount} medium`);
  if (lowCount > 0) parts.push(`${lowCount} low`);
  const summaryText = `${alerts.length} new alert${alerts.length !== 1 ? "s" : ""} found — ${parts.join(", ")} priority`;

  // Sort alerts: high first, then medium, then low
  const sorted = [...alerts].sort((a, b) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (order[a.priorityLevel] ?? 2) - (order[b.priorityLevel] ?? 2);
  });

  // Build alert cards HTML
  const alertCardsHtml = sorted
    .map((alert) => {
      const categoryLabel = CATEGORY_LABELS[alert.category] || alert.category;
      const priorityColor = PRIORITY_COLORS[alert.priorityLevel] || "#6B6B68";
      const emoji = PRIORITY_EMOJI[alert.priorityLevel] || "";
      const snippet = alert.postBody
        ? escapeHtml(alert.postBody.slice(0, 150) + (alert.postBody.length > 150 ? "..." : ""))
        : "";

      return `
      <div style="background-color: #1A1A1A; border: 1px solid #2A2A2A; border-left: 3px solid ${priorityColor}; border-radius: 10px; padding: 18px; margin-bottom: 12px;">
        <!-- Priority + Subreddit + Time -->
        <div style="margin-bottom: 10px;">
          <span style="font-size: 11px; font-weight: 700; color: ${priorityColor}; text-transform: uppercase; letter-spacing: 0.05em;">${emoji} ${alert.priorityLevel}</span>
          <span style="color: #555; margin: 0 6px;">·</span>
          <span style="font-size: 12px; color: #FFFFFF; font-weight: 500;">r/${escapeHtml(alert.subreddit)}</span>
          <span style="color: #555; margin: 0 6px;">·</span>
          <span style="font-size: 12px; color: #CCCCCC;">${escapeHtml(alert.timeAgo)}</span>
        </div>

        <!-- Title -->
        <h3 style="font-size: 15px; font-weight: 600; color: #FFFFFF; margin: 0 0 8px 0; line-height: 1.5;">
          ${escapeHtml(alert.postTitle)}
        </h3>

        ${snippet ? `<p style="font-size: 13px; color: #BBBBBB; line-height: 1.5; margin: 0 0 12px 0;">${snippet}</p>` : ""}

        <!-- Category + Stats -->
        <div style="margin-bottom: 14px;">
          <span style="display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; background-color: rgba(232, 101, 26, 0.12); color: #E8651A;">${categoryLabel}</span>
          <span style="font-size: 12px; color: #CCCCCC; margin-left: 10px;">${alert.upvotes} ↑</span>
          <span style="font-size: 12px; color: #CCCCCC; margin-left: 8px;">${alert.numComments} comments</span>
        </div>

        <!-- CTAs -->
        <div>
          <a href="${APP_URL}/dashboard" style="display: inline-block; padding: 8px 16px; font-size: 12px; font-weight: 600; color: #FFFFFF; background-color: #E8651A; border-radius: 6px; text-decoration: none; margin-right: 8px;">Check on Dashboard</a>
          <a href="${escapeHtml(alert.postUrl)}" style="display: inline-block; padding: 8px 16px; font-size: 12px; font-weight: 500; color: #CCCCCC; background-color: #2A2A2A; border-radius: 6px; text-decoration: none;">View on Reddit ↗</a>
        </div>
      </div>`;
    })
    .join("\n");

  // Build alert cards text
  const alertCardsText = sorted
    .map((alert, i) => {
      const categoryLabel = CATEGORY_LABELS[alert.category] || alert.category;
      return `${i + 1}. [${alert.priorityLevel.toUpperCase()}] r/${alert.subreddit} · ${alert.timeAgo}
   ${alert.postTitle}
   ${categoryLabel} · ${alert.upvotes} ↑ · ${alert.numComments} comments
   Dashboard: ${APP_URL}/dashboard
   Reddit: ${alert.postUrl}`;
    })
    .join("\n\n");

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin: 0; padding: 0; background-color: #0A0A0A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 20px;">

    <!-- Header -->
    <div style="margin-bottom: 24px;">
      <span style="font-size: 20px; font-weight: 700; color: #E8651A;">Arete</span>
    </div>

    <!-- Summary -->
    <div style="margin-bottom: 20px;">
      <h1 style="font-size: 18px; font-weight: 600; color: #FFFFFF; margin: 0 0 6px 0;">
        New alerts for ${escapeHtml(businessName)}
      </h1>
      <p style="font-size: 14px; color: #BBBBBB; margin: 0;">
        ${escapeHtml(summaryText)}
      </p>
    </div>

    <!-- Alert Cards -->
    ${alertCardsHtml}

    <!-- View All CTA -->
    <div style="text-align: center; margin: 24px 0;">
      <a href="${APP_URL}/dashboard" style="display: inline-block; padding: 12px 28px; font-size: 14px; font-weight: 600; color: #FFFFFF; background-color: #E8651A; border-radius: 8px; text-decoration: none;">
        View All on Dashboard →
      </a>
    </div>

    <!-- Footer -->
    <div style="font-size: 12px; color: #555; line-height: 1.6; border-top: 1px solid #2A2A2A; padding-top: 16px;">
      <p>You're receiving this because you have email alerts enabled.</p>
      <p>Manage your notification preferences in <a href="${APP_URL}/settings" style="color: #E8651A; text-decoration: none;">Settings</a>.</p>
    </div>

  </div>
</body>
</html>`;

  const textBody = `New Arete Alerts for ${businessName}

${summaryText}

${alertCardsText}

---
View all: ${APP_URL}/dashboard
Manage notifications: ${APP_URL}/settings`;

  try {
    await ses.send(
      new SendEmailCommand({
        Source: `Arete <${FROM_EMAIL}>`,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlBody, Charset: "UTF-8" },
            Text: { Data: textBody, Charset: "UTF-8" },
          },
        },
      })
    );
    return true;
  } catch (err) {
    console.error("[SES] Failed to send batched email:", (err as Error).message);
    return false;
  }
}

/** Escape HTML to prevent XSS in email content */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

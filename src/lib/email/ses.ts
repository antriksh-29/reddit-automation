import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/**
 * Amazon SES email client.
 * Ref: TECH-SPEC.md §11 (Email Service), PRODUCT-SPEC.md §6.4
 *
 * Used for: high-priority alert emails to users.
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

/**
 * Send a high-priority alert email to the user.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendAlertEmail(
  toEmail: string,
  alert: AlertEmailData
): Promise<boolean> {
  const categoryLabel = CATEGORY_LABELS[alert.category] || alert.category;
  const priorityColor = PRIORITY_COLORS[alert.priorityLevel] || "#6B6B68";
  const snippet = alert.postBody
    ? alert.postBody.slice(0, 200) + (alert.postBody.length > 200 ? "..." : "")
    : "";

  const priorityEmoji = alert.priorityLevel === "high" ? "🔴" : "🟡";
  const subject = `${priorityEmoji} ${alert.priorityLevel === "high" ? "High" : "Medium"} Priority Alert · r/${alert.subreddit} · ${alert.postTitle.slice(0, 80)}`;

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
    <div style="margin-bottom: 28px;">
      <span style="font-size: 20px; font-weight: 700; color: #E8651A;">Arete</span>
      <span style="font-size: 13px; color: #6B6B68; margin-left: 8px;">Alert</span>
    </div>

    <!-- Alert Card -->
    <div style="background-color: #1A1A1A; border: 1px solid #2A2A2A; border-left: 3px solid ${priorityColor}; border-radius: 10px; padding: 20px; margin-bottom: 24px;">

      <!-- Priority + Subreddit + Time -->
      <div style="margin-bottom: 12px;">
        <span style="display: inline-block; font-size: 11px; font-weight: 700; color: ${priorityColor}; text-transform: uppercase; letter-spacing: 0.05em;">${alert.priorityLevel}</span>
        <span style="color: #555; margin: 0 6px;">·</span>
        <span style="font-size: 12px; color: #FFFFFF; font-weight: 500;">r/${alert.subreddit}</span>
        <span style="color: #555; margin: 0 6px;">·</span>
        <span style="font-size: 12px; color: #CCCCCC;">${alert.timeAgo}</span>
      </div>

      <!-- Title -->
      <h2 style="font-size: 16px; font-weight: 600; color: #FFFFFF; margin: 0 0 12px 0; line-height: 1.5;">
        ${escapeHtml(alert.postTitle)}
      </h2>

      <!-- Snippet -->
      ${snippet ? `<p style="font-size: 14px; color: #BBBBBB; line-height: 1.6; margin: 0 0 16px 0;">${escapeHtml(snippet)}</p>` : ""}

      <!-- Category + Stats -->
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; background-color: rgba(232, 101, 26, 0.12); color: #E8651A;">${categoryLabel}</span>
        <span style="font-size: 12px; color: #CCCCCC; margin-left: 10px;">${alert.upvotes} ↑</span>
        <span style="font-size: 12px; color: #CCCCCC; margin-left: 8px;">${alert.numComments} comments</span>
      </div>

      <!-- CTA Buttons -->
      <div>
        <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://app.getarete.co"}/threads?url=${encodeURIComponent(alert.postUrl)}"
           style="display: inline-block; padding: 10px 20px; font-size: 13px; font-weight: 600; color: #FFFFFF; background-color: #E8651A; border-radius: 6px; text-decoration: none; margin-right: 8px;">
          Analyze Thread
        </a>
        <a href="${alert.postUrl}"
           style="display: inline-block; padding: 10px 20px; font-size: 13px; font-weight: 500; color: #CCCCCC; background-color: #2A2A2A; border-radius: 6px; text-decoration: none;">
          View on Reddit ↗
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="font-size: 12px; color: #555; line-height: 1.6;">
      <p>You're receiving this because you have email alerts enabled for medium and high-priority posts.</p>
      <p>Manage your notification preferences in <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://app.getarete.co"}/settings" style="color: #E8651A; text-decoration: none;">Settings</a>.</p>
    </div>

  </div>
</body>
</html>`;

  const textBody = `High Priority Alert · r/${alert.subreddit}

${alert.postTitle}

${snippet}

Category: ${categoryLabel}
${alert.upvotes} upvotes · ${alert.numComments} comments · ${alert.timeAgo}

Analyze: ${process.env.NEXT_PUBLIC_APP_URL || "https://app.getarete.co"}/threads?url=${encodeURIComponent(alert.postUrl)}
View on Reddit: ${alert.postUrl}

---
Manage notifications: ${process.env.NEXT_PUBLIC_APP_URL || "https://app.getarete.co"}/settings`;

  try {
    await ses.send(
      new SendEmailCommand({
        Source: `Arete Alerts <${FROM_EMAIL}>`,
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
    console.error("[SES] Failed to send email:", (err as Error).message);
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

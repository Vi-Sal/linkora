import type { Job } from "./jobs";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Phnom_Penh",
  dateStyle: "medium",
  timeStyle: "medium",
});

const oneLine = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 300);

export async function notifyMediaExport(job: Job) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const { media } = job.entry.source;
  const { view, format, edit } = job;
  if (
    !token ||
    !chatId ||
    (format.kind !== "video" && format.kind !== "audio") ||
    !media.page ||
    (media.platform !== "YouTube" && media.platform !== "TikTok") ||
    view.ended === undefined ||
    view.size === undefined
  )
    return;

  const exportType = format.kind === "video" ? "Video export" : "Audio export";
  const message = [
    `Linkora · ${exportType} completed`,
    `Requested: ${dateTime.format(view.created)} (Phnom Penh)`,
    `Completed: ${dateTime.format(view.ended)} (Phnom Penh)`,
    `Video: ${oneLine(media.title)}`,
    ...(media.creator ? [`Creator: ${oneLine(media.creator)}`] : []),
    `Source: ${media.platform}`,
    `Link: ${media.page}`,
    `Tool: ${edit.mode === "export" ? exportType : edit.mode}`,
    `Format: ${format.ext.toUpperCase()} · ${format.label}`,
    `File: ${oneLine(view.filename || "")}`,
    `Size: ${(view.size / 1048576).toFixed(2)} MiB (${view.size} bytes)`,
    `Source duration: ${Math.round(media.duration)} s`,
  ].join("\n");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        link_preview_options: { is_disabled: true },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  const result = (await response.json()) as { ok?: boolean };
  if (!response.ok || !result.ok) {
    console.warn(
      JSON.stringify({
        event: "telegram_delivery_rejected",
        job: view.id,
        status: response.status,
      }),
    );
    return;
  }
  console.info(
    JSON.stringify({ event: "telegram_delivery_sent", job: view.id }),
  );
}

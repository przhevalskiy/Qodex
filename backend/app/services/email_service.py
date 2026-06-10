import logging
import resend
from app.core.config import get_settings

logger = logging.getLogger(__name__)


def send_submission_copy(fields: dict, hive_task_id: str) -> None:
    settings = get_settings()
    if not settings.resend_api_key or not settings.email_cc_address:
        return

    resend.api_key = settings.resend_api_key

    rows = "".join(
        f"<tr><td style='padding:6px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;'>{k.replace('_', ' ').title()}</td>"
        f"<td style='padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;'>{v}</td></tr>"
        for k, v in fields.items()
    )

    html = f"""
    <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <div style="background:#1d4ed8;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">New Cowork Submission</h1>
        <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Task ID: {hive_task_id}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        {rows}
      </table>
      <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by Cowork · CBS Marketing & Communications</p>
      </div>
    </div>
    """

    try:
        resend.Emails.send({
            "from": "Cowork <onboarding@resend.dev>",
            "to": settings.email_cc_address,
            "subject": f"Cowork Submission — {fields.get('service_type', 'Request')} ({hive_task_id})",
            "html": html,
        })
        logger.info(f"Submission copy sent to {settings.email_cc_address}")
    except Exception as e:
        logger.error(f"Failed to send submission email: {e}")

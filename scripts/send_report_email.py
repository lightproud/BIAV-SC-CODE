#!/usr/bin/env python3
"""银芯日报投递器 — 把渲染好的 PDF 报告通过 SMTP 发送到指定邮箱。

用途：daily-report 编排末步调用，把当日社区情报日报 PDF 作为附件投递。
设计遵 CLAUDE.md「配置留在 git、不依赖外部平台」：传输逻辑全在仓内，
凭据通过环境变量（GitHub Secrets）注入，脚本本身不含任何机密。

环境变量（凭据，均由 Secrets 注入）：
    SMTP_HOST   SMTP 服务器地址（必填）
    SMTP_PORT   端口（默认 465；465=SSL，587/25=STARTTLS）
    SMTP_USER   登录账号（必填）
    SMTP_PASS   登录密码 / 授权码（必填）
    SMTP_FROM   发件人地址（可选，默认 = SMTP_USER）

用法：
    python scripts/send_report_email.py --pdf deliverables/2026-06/morimens_daily_20260602.pdf \\
        --to tanglong.tang@alibaba-inc.com --subject "忘却前夜 全球社区情报日报 2026.06.02"
    # --dry-run 只校验配置与附件、组装邮件，不实际连接发送（CI 烟测用）
"""
import os, sys, ssl, smtplib, argparse, mimetypes
from email.message import EmailMessage

DEFAULT_TO = "tanglong.tang@alibaba-inc.com"


def build_message(pdf_path, to_addr, subject, body, from_addr):
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    ctype, _ = mimetypes.guess_type(pdf_path)
    maintype, subtype = (ctype or "application/pdf").split("/", 1)
    with open(pdf_path, "rb") as f:
        msg.add_attachment(
            f.read(), maintype=maintype, subtype=subtype,
            filename=os.path.basename(pdf_path),
        )
    return msg


def send(msg, host, port, user, password):
    if port == 465:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=60) as s:
            s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            s.ehlo()
            s.starttls(context=ssl.create_default_context())
            s.login(user, password)
            s.send_message(msg)


def main():
    ap = argparse.ArgumentParser(description="银芯日报 PDF 邮件投递器")
    ap.add_argument("--pdf", required=True, help="待发送的 PDF 报告路径")
    ap.add_argument("--to", default=DEFAULT_TO, help=f"收件人（默认 {DEFAULT_TO}）")
    ap.add_argument("--subject", default="忘却前夜 全球社区情报日报", help="邮件主题")
    ap.add_argument("--body", default="附件为本日忘却前夜全球社区情报日报，由银芯情报层自动生成。", help="正文")
    ap.add_argument("--dry-run", action="store_true", help="只校验与组装，不实际发送")
    a = ap.parse_args()

    if not os.path.isfile(a.pdf):
        sys.exit(f"错误：附件不存在 {a.pdf}")

    host = os.environ.get("SMTP_HOST")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    from_addr = os.environ.get("SMTP_FROM") or user

    msg = build_message(a.pdf, a.to, a.subject, a.body, from_addr or "noreply@biav.local")
    size = os.path.getsize(a.pdf)

    if a.dry_run:
        print(f"[dry-run] 组装完毕：to={a.to} subject={a.subject!r} 附件={a.pdf} ({size} bytes) from={from_addr}")
        return

    missing = [k for k, v in {"SMTP_HOST": host, "SMTP_USER": user, "SMTP_PASS": password}.items() if not v]
    if missing:
        sys.exit(f"错误：缺少 SMTP 凭据环境变量 {', '.join(missing)}")

    send(msg, host, port, user, password)
    print(f"投递完成：{a.pdf} ({size} bytes) → {a.to}（经 {host}:{port}）")


if __name__ == "__main__":
    main()

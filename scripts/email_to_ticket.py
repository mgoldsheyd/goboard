#!/usr/bin/env python3
"""Reads unseen emails from a Gmail inbox, asks Claude to extract goboard
ticket fields, and posts each one to /api/tickets.

Stdlib only. Reads all credentials from the environment (never hardcode
secrets here):
  GMAIL_ADDRESS         e.g. goboard.support@gmail.com
  GMAIL_APP_PASSWORD    16-character app password (spaces are fine)
  GOBOARD_CLAUDE_KEY    Anthropic API key, sk-ant-...
  TICKETS_API_KEY       shared secret for POST /api/tickets
"""

import email
import imaplib
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

TICKETS_URL = "https://goboard-melissa.vercel.app/api/tickets"
CLAUDE_MODEL = "claude-sonnet-5"

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

EXTRACTION_PROMPT = """You turn an email into a goboard ticket. Read the email
below and respond with ONLY a JSON object (no prose, no markdown fences)
with these fields:

  title (string, required, short summary)
  desc (string, the body/details)
  priority ("P1"|"P2"|"P3"|"P4"|"P5", guess urgency; default "P3")
  assignee (string, a person's name if mentioned, else "")
  category (string, e.g. "Frontend"/"Backend"/"Infra"/"Bug", else "")
  effort (one of "1","2","3","5","8","13","21", guess complexity, default "3")

Email subject: {subject}

Email body:
{body}
"""


def get_unseen_emails():
    address = os.environ["GMAIL_ADDRESS"]
    app_password = "".join(os.environ["GMAIL_APP_PASSWORD"].split())

    imap = imaplib.IMAP4_SSL("imap.gmail.com", ssl_context=SSL_CONTEXT)
    imap.login(address, app_password)
    imap.select("INBOX")

    status, data = imap.search(None, "UNSEEN")
    if status != "OK":
        imap.logout()
        return []

    msg_nums = data[0].split()
    messages = []
    for num in msg_nums:
        status, msg_data = imap.fetch(num, "(BODY.PEEK[])")
        if status != "OK":
            continue
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)
        messages.append((num, msg))
    return imap, messages


def get_body_text(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                charset = part.get_content_charset() or "utf-8"
                return part.get_payload(decode=True).decode(charset, errors="replace")
        return ""
    charset = msg.get_content_charset() or "utf-8"
    return msg.get_payload(decode=True).decode(charset, errors="replace")


def extract_ticket_fields(subject, body):
    prompt = EXTRACTION_PROMPT.format(subject=subject, body=body[:4000])
    payload = json.dumps({
        "model": CLAUDE_MODEL,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        method="POST",
        headers={
            "x-api-key": os.environ["GOBOARD_CLAUDE_KEY"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, context=SSL_CONTEXT) as resp:
        result = json.load(resp)
    text = next(b["text"] for b in result["content"] if b["type"] == "text").strip()
    # Model sometimes wraps JSON in markdown fences despite instructions
    if text.startswith("```"):
        text = text.split("```")[1].lstrip("json").strip()
    return json.loads(text)


def create_ticket(fields):
    payload = json.dumps(fields).encode()
    req = urllib.request.Request(
        TICKETS_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['TICKETS_API_KEY']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, context=SSL_CONTEXT) as resp:
        return json.load(resp)


def main():
    imap, messages = get_unseen_emails()
    if not messages:
        print("No unseen emails.")
        imap.logout()
        return

    for num, msg in messages:
        subject = msg.get("Subject", "(no subject)")
        try:
            body = get_body_text(msg)
            fields = extract_ticket_fields(subject, body)
            result = create_ticket(fields)
            imap.store(num, "+FLAGS", "\\Seen")
            print(f"Created {result['ticket']['id']} from '{subject}'")
        except (urllib.error.HTTPError, urllib.error.URLError, KeyError, json.JSONDecodeError) as e:
            print(f"Skipped '{subject}': {e}", file=sys.stderr)

    imap.logout()


if __name__ == "__main__":
    main()

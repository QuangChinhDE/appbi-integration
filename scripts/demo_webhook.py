"""Call a workflow's webhook the way a real sender would.

    python scripts/demo_webhook.py --url http://localhost:8010/hooks/<key>
    python scripts/demo_webhook.py --url ... --rush
    python scripts/demo_webhook.py --url ... --unsigned      # see it refused

The signature is the point. A webhook whose URL is enough to trigger it is a
webhook anybody who has ever seen the URL can trigger, so the product signs
`timestamp.body` with HMAC-SHA256 and rejects anything else. This script shows
what a sender has to do, and `--unsigned` shows what happens when they do not.

The secret is only ever shown once, when it is created or rotated. Rotate it in
the workflow's trigger panel and pass the new value here with `--secret`.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.request

SIGNATURE_HEADER = "X-AppBI-Signature"
TIMESTAMP_HEADER = "X-AppBI-Timestamp"


def send(url: str, body: bytes, headers: dict[str, str]) -> tuple[int, str]:
    request = urllib.request.Request(url, method="POST", data=body)
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()
    except urllib.error.URLError as error:
        return 0, str(error)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Send a signed request to a workflow's webhook.")
    parser.add_argument("--url", required=True)
    parser.add_argument(
        "--secret", default=None,
        help="the signing secret shown when it was created or rotated")
    parser.add_argument("--order-id", default=None)
    parser.add_argument("--rush", action="store_true",
                        help="mark the order urgent, taking the other branch")
    parser.add_argument("--unsigned", action="store_true",
                        help="send without a signature, to see it refused")
    parser.add_argument(
        "--replay", action="store_true",
        help="sign with a timestamp ten minutes old, to see the replay "
             "window refuse it")
    args = parser.parse_args()

    payload = {
        "order_id": args.order_id or f"DH-{int(time.time()) % 100000}",
        "rush": bool(args.rush),
        "customer": "Khách từ website",
    }
    body = json.dumps(payload).encode()

    headers = {"Content-Type": "application/json"}
    if not args.unsigned:
        if not args.secret:
            print(
                "No --secret given.\n\n"
                "The signing secret is shown exactly once, when it is created "
                "or rotated. Open the workflow, select the webhook step, and "
                "press 'Tạo khóa mới' -- the new secret appears once in a "
                "toast. Then:\n\n"
                f"  python scripts/demo_webhook.py --url {args.url} "
                "--secret <the value>\n\n"
                "Or use --unsigned to watch the gateway refuse an unsigned "
                "request.", file=sys.stderr)
            return 2
        sent_at = int(time.time()) - (600 if args.replay else 0)
        timestamp = str(sent_at)
        signature = hmac.new(
            args.secret.encode(), f"{timestamp}.".encode() + body,
            hashlib.sha256).hexdigest()
        headers[TIMESTAMP_HEADER] = timestamp
        headers[SIGNATURE_HEADER] = f"sha256={signature}"

    print(f"POST {args.url}")
    print(f"  body: {json.dumps(payload, ensure_ascii=False)}")
    print(f"  signed: {'no' if args.unsigned else 'yes'}"
          + ("  (timestamp 10 minutes old)" if args.replay else ""))

    status, response = send(args.url, body, headers)
    print(f"\n  -> {status} {response[:300]}")

    if status == 202:
        print("\n  Accepted. The gateway answers immediately and the run "
              "happens in the background --")
        print("  open 'Lần chạy' in the interface to watch it.")
    elif status in (401, 403, 404):
        print("\n  Refused. Note that an unknown key and a disabled trigger "
              "answer identically,")
        print("  so the endpoint cannot be used to find out which workflows "
              "exist.")
    return 0 if status == 202 else 1


if __name__ == "__main__":
    sys.exit(main())

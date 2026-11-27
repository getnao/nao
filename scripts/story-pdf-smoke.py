"""Sign up on a running `nao chat`, create a story over MCP, and export it as a PDF."""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = os.environ.get("NAO_URL", "http://localhost:5005")
STORY_CONTENT = "# Windows PDF smoke test\n\nThis story checks that the PDF export works.\n"


def main() -> None:
    output_path = Path(sys.argv[1] if len(sys.argv) > 1 else "story.pdf")
    wait_for_server()
    token = sign_up()
    story_id = create_story(token)
    pdf = download_story_pdf(token, story_id)
    output_path.write_bytes(pdf)
    print(f"PDF export OK: {len(pdf)} bytes written to {output_path}")


def wait_for_server(timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{BASE_URL}/api", timeout=5)
            return
        except urllib.error.HTTPError:
            return
        except OSError:
            time.sleep(1)
    sys.exit(f"Server not reachable on {BASE_URL} after {timeout_seconds}s")


def sign_up() -> str:
    body = {"name": "Smoke Test", "email": f"smoke-{int(time.time())}@nao.test", "password": "smoke-password-1234"}
    response = request("POST", "/api/auth/sign-up/email", body)
    return json.loads(response)["token"]


def create_story(token: str) -> str:
    call = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "create_story", "arguments": {"title": "Windows PDF smoke", "content": STORY_CONTENT}},
    }
    headers = {"Accept": "application/json, text/event-stream"}
    response = request("POST", "/mcp", call, token, headers).decode()
    result = parse_json_rpc(response)["result"]
    if result.get("isError"):
        sys.exit(f"create_story failed: {result}")
    return result["structuredContent"]["id"]


def download_story_pdf(token: str, story_id: str) -> bytes:
    query = urllib.parse.urlencode({"input": json.dumps({"json": {"storyId": story_id, "format": "pdf"}})})
    response = json.loads(request("GET", f"/api/trpc/story.downloadStandalone?{query}", token=token))
    data = response["result"]["data"]["json"]

    pdf = base64.b64decode(data["data"])
    if not pdf.startswith(b"%PDF-"):
        sys.exit(f"Downloaded file is not a PDF: {pdf[:64]!r}")
    return pdf


def parse_json_rpc(response: str) -> dict:
    if response.lstrip().startswith("{"):
        return json.loads(response)
    for line in response.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :])
    sys.exit(f"Unexpected MCP response: {response[:500]}")


def request(
    method: str, path: str, body: dict | None = None, token: str | None = None, headers: dict | None = None
) -> bytes:
    all_headers = {"Content-Type": "application/json", "Origin": BASE_URL, **(headers or {})}
    if token:
        all_headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=all_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        sys.exit(f"{method} {path} failed with {error.code}: {error.read()[:2000]!r}")


if __name__ == "__main__":
    main()

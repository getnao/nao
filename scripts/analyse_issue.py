import os
import requests

OLLAMA_URL = os.environ["OLLAMA_URL"]
ISSUE_NUMBER = os.environ["ISSUE_NUMBER"]
ISSUE_TITLE = os.environ["ISSUE_TITLE"]

def analyze_issue():
    payload = {
        "model": "minimax-m2.5:cloud",
        "messages": [
            {"role": "user", "content": f"**Analyse Issue #{ISSUE_NUMBER} : {ISSUE_TITLE}**"}
        ],
        "stream": False
    }

    requests.post(OLLAMA_URL, json=payload, timeout=120)

if __name__ == "__main__":
    analyze_issue()
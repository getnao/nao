import re


def normalize(value: str) -> str:
    return re.sub(r"[\s_-]+", "", value.lower())

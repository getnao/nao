from pydantic import BaseModel


class TableauConfig(BaseModel):
    server: str
    site_name: str = ""
    pat_name: str
    pat_value: str
    api_version: str = "3.21"

from pydantic import BaseModel, Field


class MetabaseConfig(BaseModel):
    url: str = Field(min_length=1, description="The Metabase base URL")
    api_key: str = Field(min_length=1, description="The Metabase API key")

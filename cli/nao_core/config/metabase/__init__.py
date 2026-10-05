from pydantic import BaseModel, Field, SecretStr


class MetabaseConfig(BaseModel):
    url: str = Field(min_length=1, description="The Metabase base URL")
    api_key: SecretStr = Field(min_length=1, description="The Metabase API key")

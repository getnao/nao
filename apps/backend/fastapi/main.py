from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import sys
from pathlib import Path

cli_path = Path(__file__).parent.parent.parent / "cli"
sys.path.insert(0, str(cli_path))

from nao_core.config import BigQueryConfig

port = int(os.environ.get("PORT", 8005))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExecuteSQLRequest(BaseModel):
    sql: str
    project_id: str
    dataset_id: str | None = None
    credentials_path: str | None = None


class ExecuteSQLResponse(BaseModel):
    data: list[dict]
    row_count: int
    columns: list[str]


@app.post("/execute_sql", response_model=ExecuteSQLResponse)
async def execute_sql(request: ExecuteSQLRequest):
    try:
        bq_config = BigQueryConfig(
            name="bigquery_connection",
            project_id=request.project_id,
            dataset_id=request.dataset_id,
            credentials_path=request.credentials_path,
        )

        connection = bq_config.connect()
        result = connection.sql(request.sql)

        df = result.to_pandas()
        data = df.to_dict(orient="records")

        return ExecuteSQLResponse(
            data=data,
            row_count=len(data),
            columns=df.columns.tolist(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=port)

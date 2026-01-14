from fastapi import FastAPI, Form, BackgroundTasks, Request, HTTPException
from pydantic import BaseModel
import httpx
import asyncio
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import sys
from pathlib import Path
import requests
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import json
import re

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


async def process_sql_query(sql_query: str, response_url: str = None):
    try:    
        bq_config = BigQueryConfig(
            name="bigquery_connection",
            project_id="nao-corp",
            credentials_path="/Users/mateolebrassancho/Downloads/nao-corp-1693265c8499.json",
        )
        
        connection = bq_config.connect()
        result = connection.sql(sql_query)
        
        df = result.to_pandas()
        
        row_count = len(df)
        preview = df.head(10).to_string(index=False) if row_count > 0 else "Aucun résultat"

        final_response = {
            "response_type": "in_channel",
            "text":  f"✅ Requête exécutée avec succès !\n\n*Résultats : * {row_count} ligne(s)\n\n```\n{preview}\n```"
        }
        
        if response_url is not None:
            requests.post(response_url, json=final_response)
        return final_response
            
    except Exception as e:
        error_response = {
            "response_type": "ephemeral",
            "text": f"❌ Erreur lors de l'exécution :\n```{str(e)}```"
        }

        requests.post(response_url, json=error_response)


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


@app.post("/slack/command")
async def slack_command(
    text: str = Form(...),
    user_name: str = Form(... ),
    response_url: str = Form(...),
    background_tasks: BackgroundTasks = None
):
    background_tasks.add_task(process_sql_query, text, response_url)
    
    return {
        "text": "Analyzing your request... This may take a moment."
    }


@app.post("/slack/app_mention")
async def slack_mention(
    request: Request
):
    body = await request.body()
    data = json.loads(body)
    print("Received Slack mention:", data)

    if data.get("type") == "url_verification":
        challenge = data.get("challenge")
        return {"challenge": challenge}

    text = data.get("event", {}).get("text", "")
    text = re.sub(r'<@[A-Z0-9]+>', '', text).strip()

    result = await process_sql_query(text)

    requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={
            "Content-Type": "application/json",
        },
        json=dict(
            token=data["token"],
            channel=data["event"]["channel"],
            text=result["text"]
        )
    )


@app.post("/")
async def health_check():
    print("Health check endpoint called.")
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=port)

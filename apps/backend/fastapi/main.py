from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import sys
from pathlib import Path

cli_path = Path(__file__).parent.parent.parent / "cli"
sys.path.insert(0, str(cli_path))

from nao_core.config import NaoConfig

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
    nao_project_folder: str
    database_id: str | None = None


class ExecuteSQLResponse(BaseModel):
    data: list[dict]
    row_count: int
    columns: list[str]


@app.post("/execute_sql", response_model=ExecuteSQLResponse)
async def execute_sql(request: ExecuteSQLRequest):
    try:
        # Load the nao config from the project folder
        project_path = Path(request.nao_project_folder)
        config = NaoConfig.try_load(project_path)
        
        if config is None:
            raise HTTPException(
                status_code=400,
                detail=f"Could not load nao_config.yaml from {request.nao_project_folder}"
            )
        
        if len(config.databases) == 0:
            raise HTTPException(
                status_code=400,
                detail="No databases configured in nao_config.yaml"
            )
        
        # Determine which database to use
        if len(config.databases) == 1:
            db_config = config.databases[0]
        elif request.database_id:
            # Find the database by name
            db_config = next(
                (db for db in config.databases if db.name == request.database_id),
                None
            )
            if db_config is None:
                available_databases = [db.name for db in config.databases]
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": f"Database '{request.database_id}' not found",
                        "available_databases": available_databases
                    }
                )
        else:
            # Multiple databases and no database_id specified
            available_databases = [db.name for db in config.databases]
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Multiple databases configured. Please specify database_id.",
                    "available_databases": available_databases
                }
            )

        connection = db_config.connect()
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


@app.post("/")
async def health_check():
    print("Health check endpoint called.")
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

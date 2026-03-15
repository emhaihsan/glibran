from fastapi import FastAPI
import modal

app = FastAPI()

stub = modal.App("glibran-backend")

@app.get("/")
def read_root():
    return {"message": "Hello from Glibran FastAPI backend!"}

@stub.function()
@modal.asgi_app()
def fastapi_app():
    return app
